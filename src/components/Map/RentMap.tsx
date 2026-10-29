import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap, Marker } from 'leaflet';
import { CITIES } from '../../data/cities';
import { APPROXIMATE_POSITION_NOTICE, CITY_POSITIONS, LISTING_POSITIONS } from '../../data/mapCoordinates';
import type { Listing } from '../../types';
import {
  LEAFLET_LICENSE_FILE,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  OSM_ATTRIBUTION_HTML,
  OSM_TILE_URL,
  TIER_RANGE_TEXT,
  cityContextMarkers,
  createMapFramer,
  createTileFailureTracker,
  disablePanAnimation,
  formatScore,
  planMapView,
  splitListingsByPosition,
} from './mapModel';
import type { ContextMarker, MapFramer, MapViewPlan, PlottedListing } from './mapModel';

type LeafletModule = typeof import('leaflet');

// Leaflet reads window and document when its module runs, so it is imported only from the effect
// below, after the component has mounted in a browser. It ships a UMD build, which a bundler may
// expose as the default export.
async function loadLeaflet(): Promise<LeafletModule> {
  const loaded = await import('leaflet');
  return (loaded as unknown as { default?: LeafletModule }).default ?? loaded;
}

interface MapEngine {
  L: LeafletModule;
  map: LeafletMap;
  pins: LayerGroup;
  context: LayerGroup;
  /** What each layer currently shows. An unchanged key means the DOM, and any focus in it, is left alone. */
  pinKey: string | null;
  contextKey: string | null;
  framer: MapFramer;
  pinTeardowns: Array<() => void>;
}

const CONTEXT_PANE = 'rentMapContext';
const PIN_SIZE_PX = 40;
// The ring is a 44 px square turned 45 degrees, so its corners reach about 62 px across.
const CONTEXT_SIZE_PX = 64;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createEngine(L: LeafletModule, container: HTMLElement, onTilesFailed: (failed: boolean) => void): MapEngine {
  const reduceMotion = prefersReducedMotion();
  // On a touch screen one finger scrolls the page and two fingers pan and pinch the map, so a swipe
  // that starts on the map can still reach the content below it.
  const touchOnly = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const map = L.map(container, {
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    attributionControl: false,
    dragging: !touchOnly,
    zoomAnimation: !reduceMotion,
    fadeAnimation: !reduceMotion,
    markerZoomAnimation: !reduceMotion,
    // Inertia is the slide after a drag. With the panBy wrapper below, reduced motion has no slide.
    inertia: !reduceMotion,
  });
  // Leaflet's arrow keys pan with an animation that no map option turns off.
  if (reduceMotion) disablePanAnimation(map);
  try {
    // Bottom left, so the fixed Copilot button at the bottom right of the screen cannot cover it.
    L.control.attribution({ position: 'bottomleft' }).addTo(map);
    const tiles = L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION_HTML, maxZoom: MAP_MAX_ZOOM });
    // A failed tile keeps the notice up until it loads or leaves the layer. Another tile loading
    // does not clear it.
    const failures = createTileFailureTracker(onTilesFailed);
    tiles.on('tileerror', (event) => failures.fail(event.tile));
    tiles.on('tileload', (event) => failures.release(event.tile));
    tiles.on('tileunload', (event) => failures.release(event.tile));
    tiles.addTo(map);
    // Below the marker pane, so a context marker can never sit over a listing pin.
    map.createPane(CONTEXT_PANE).style.zIndex = '450';
    return {
      L,
      map,
      context: L.layerGroup().addTo(map),
      pins: L.layerGroup().addTo(map),
      pinKey: null,
      contextKey: null,
      framer: createMapFramer(map),
      pinTeardowns: [],
    };
  } catch (error) {
    map.remove();
    throw error;
  }
}

function disposeEngine(engine: MapEngine) {
  engine.pinTeardowns.splice(0).forEach((teardown) => teardown());
  engine.map.remove();
}

/**
 * Makes a pin act like a button. Leaflet's own Enter handling only opens a bound popup, and it has
 * no Space handling, so the keys are handled here. Enter acts on keydown and Space on keyup, like a
 * native button, so the key release cannot land on the dialog this opens.
 */
function bindPin(marker: Marker, label: string, activate: () => void): () => void {
  let icon: HTMLElement | null = null;
  let spaceArmed = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) activate();
    } else if (event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      spaceArmed = true;
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== ' ' || !spaceArmed) return;
    spaceArmed = false;
    event.preventDefault();
    event.stopPropagation();
    activate();
  };
  const onBlur = () => {
    spaceArmed = false;
  };
  const onClick = () => activate();

  // The icon exists only once the map has a view and the marker is added, so wire it up then.
  const onAdd = () => {
    icon = marker.getElement() ?? null;
    if (!icon) return;
    icon.setAttribute('aria-label', label);
    icon.setAttribute('aria-haspopup', 'dialog');
    icon.addEventListener('keydown', onKeyDown);
    icon.addEventListener('keyup', onKeyUp);
    icon.addEventListener('blur', onBlur);
  };
  marker.on('add', onAdd);
  marker.on('click', onClick);

  return () => {
    marker.off('add', onAdd);
    marker.off('click', onClick);
    icon?.removeEventListener('keydown', onKeyDown);
    icon?.removeEventListener('keyup', onKeyUp);
    icon?.removeEventListener('blur', onBlur);
  };
}

function syncPins(engine: MapEngine, plotted: readonly PlottedListing[], select: (listingId: string) => void) {
  const key = plotted.map((p) => p.signature).join('\n');
  if (engine.pinKey === key) return;
  engine.pinKey = key;
  engine.pinTeardowns.splice(0).forEach((teardown) => teardown());
  engine.pins.clearLayers();
  const { L } = engine;
  for (const { listing, point, tier, label } of plotted) {
    // Text goes in through DOM text nodes and attributes only, never as markup.
    const score = document.createElement('span');
    score.textContent = formatScore(listing.dealScore);
    const marker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        className: `rent-map-pin rent-map-pin--${tier}`,
        html: score,
        iconSize: [PIN_SIZE_PX, PIN_SIZE_PX],
      }),
      keyboard: true,
      title: listing.title,
      riseOnHover: true,
    });
    engine.pinTeardowns.push(bindPin(marker, label, () => select(listing.id)));
    marker.addTo(engine.pins);
  }
}

function syncContext(engine: MapEngine, markers: readonly ContextMarker[]) {
  const key = markers.map((m) => m.cityId).join(',');
  if (engine.contextKey === key) return;
  engine.contextKey = key;
  engine.context.clearLayers();
  const { L } = engine;
  for (const { point } of markers) {
    // Not interactive and not focusable: it is context, not a listing. The text under the map names it.
    const marker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        className: 'rent-map-context',
        html: document.createElement('span'),
        iconSize: [CONTEXT_SIZE_PX, CONTEXT_SIZE_PX],
      }),
      interactive: false,
      keyboard: false,
      pane: CONTEXT_PANE,
    });
    marker.on('add', () => marker.getElement()?.setAttribute('aria-hidden', 'true'));
    marker.addTo(engine.context);
  }
}

function syncView(engine: MapEngine, plan: MapViewPlan) {
  // The first view is placed in one step. Later ones animate unless the user asks for less motion.
  engine.framer.show(plan, !prefersReducedMotion());
}

interface MappedListingListProps {
  plotted: readonly PlottedListing[];
  onSelect: (listing: Listing) => void;
}

/**
 * A plain list of the mapped listings. Pins can sit on top of each other at a wide zoom, and this
 * keeps every one of them selectable by keyboard and touch without a clustering library.
 */
export const MappedListingList: React.FC<MappedListingListProps> = ({ plotted, onSelect }) => (
  <ul className="max-h-72 overflow-y-auto divide-y divide-zinc-900 border border-zinc-800 bg-zinc-950">
    {plotted.map(({ listing, tier }) => (
      <li key={listing.id}>
        <button
          type="button"
          onClick={() => onSelect(listing)}
          className="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white cursor-pointer"
        >
          <span className={`rent-map-swatch rent-map-pin--${tier}`}>{formatScore(listing.dealScore)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-zinc-100 line-clamp-2">{listing.title}</span>
            <span className="block text-[11px] text-zinc-400 truncate">
              {listing.neighborhood}, {listing.cityName}
            </span>
          </span>
          <span className="shrink-0 text-[11px] text-emerald-400">
            {Number.isFinite(listing.savingsPercentage) ? `-${listing.savingsPercentage}% MKT` : 'n/a'}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

interface RentMapProps {
  /** The listings the grid would show: App's shared filtered and sorted result. */
  listings: readonly Listing[];
  selectedCityId: string;
  /** Opens the app's existing listing dossier. It may change every render. */
  onSelectListing: (listing: Listing) => void;
}

const LEGEND_TIERS = [
  { tier: 'green', text: `Deal score ${TIER_RANGE_TEXT.green}` },
  { tier: 'amber', text: `Deal score ${TIER_RANGE_TEXT.amber}` },
  { tier: 'neutral', text: `Deal score ${TIER_RANGE_TEXT.neutral}, or unavailable` },
] as const;

export const RentMap: React.FC<RentMapProps> = ({ listings, selectedCityId, onSelectListing }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const { plotted, omitted } = useMemo(() => splitListingsByPosition(listings, LISTING_POSITIONS), [listings]);
  const contextMarkers = useMemo(
    () => cityContextMarkers(CITIES, selectedCityId, CITY_POSITIONS),
    [selectedCityId],
  );
  const viewPlan = useMemo(
    () => planMapView(selectedCityId, plotted, CITY_POSITIONS),
    [selectedCityId, plotted],
  );

  // Pins outlive many renders, so they read the latest listings and callback from here instead of
  // closing over them. That keeps a pin's DOM element, and the focus on it, stable while the dossier
  // opens and closes or a pay figure changes.
  const latest = useRef({ plotted, onSelectListing });
  useLayoutEffect(() => {
    latest.current = { plotted, onSelectListing };
  });
  const selectById = useCallback((listingId: string) => {
    const hit = latest.current.plotted.find((p) => p.listing.id === listingId);
    if (hit) latest.current.onSelectListing(hit.listing);
  }, []);

  // One map per mount. Cleanup also covers React StrictMode's setup, cleanup, setup in development,
  // and a Leaflet import that settles after the component has gone.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let engine: MapEngine | null = null;
    let resizeObserver: ResizeObserver | undefined;

    loadLeaflet()
      .then((L) => {
        if (disposed) return;
        const created = createEngine(L, container, setTilesFailed);
        engine = created;
        engineRef.current = created;
        if (typeof ResizeObserver !== 'undefined') {
          // A real size change frames the current view again: a fit made for a wide map clips pins on a narrow one.
          resizeObserver = new ResizeObserver(() => created.framer.resize());
          resizeObserver.observe(container);
        }
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setLoadFailed(true);
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (engine) disposeEngine(engine);
      engineRef.current = null;
      setReady(false);
      setTilesFailed(false);
    };
  }, []);

  useEffect(() => {
    if (ready && engineRef.current) syncPins(engineRef.current, plotted, selectById);
  }, [ready, plotted, selectById]);

  useEffect(() => {
    if (ready && engineRef.current) syncContext(engineRef.current, contextMarkers);
  }, [ready, contextMarkers]);

  useEffect(() => {
    if (ready && engineRef.current) syncView(engineRef.current, viewPlan);
  }, [ready, viewPlan]);

  const omittedText =
    omitted.length === 1
      ? '1 listing has no valid approximate position and is not on the map.'
      : `${omitted.length} listings have no valid approximate position and are not on the map.`;

  return (
    <section aria-labelledby="radar-map-heading" className="mb-8 font-mono">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 mb-2 text-xs">
        <h3 id="radar-map-heading" className="font-bold text-zinc-200 uppercase">
          Radar map ({plotted.length} of {listings.length} mapped)
        </h3>
        <span className="text-zinc-400 font-sans">
          {APPROXIMATE_POSITION_NOTICE}. Pins are neighborhood-scale points, not actual homes or named stops.
        </span>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          role="region"
          aria-label="Radar map of demo fixture listings. Approximate demo positions, not property addresses."
          hidden={loadFailed}
          className="rent-map h-80 sm:h-[30rem] w-full border-2 border-zinc-800"
        />
        <div role="status" className="pointer-events-none absolute left-14 right-2 top-2 z-10 text-xs">
          {!ready && !loadFailed && (
            <p className="inline-block border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-300">Loading map…</p>
          )}
          {tilesFailed && (
            <p className="inline-block border border-amber-700 bg-zinc-950 px-2 py-1 text-amber-300">
              Basemap tiles are unavailable for some or all of this map. Listing pins, the list below, and Grid view still work.
            </p>
          )}
        </div>
      </div>
      {loadFailed && (
        <p role="alert" className="border border-red-900 bg-zinc-950 p-4 text-xs text-red-300">
          The map could not load. Use the list below or switch to Grid view to open every listing.
        </p>
      )}
      <p className="mt-1 hidden pointer-coarse:block text-[11px] text-zinc-400">
        Two fingers move and zoom the map. One finger scrolls the page.
      </p>

      {omitted.length > 0 && (
        <p className="mt-2 border border-amber-900 bg-zinc-950 px-3 py-2 text-xs text-amber-300">
          {omittedText} Use Grid view to open {omitted.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div aria-labelledby="radar-map-legend-heading" role="group" className="border border-zinc-800 bg-zinc-950 p-3 text-xs">
          <h4 id="radar-map-legend-heading" className="font-bold text-zinc-200 uppercase mb-2">
            Legend
          </h4>
          <ul className="space-y-1.5 text-zinc-300">
            {LEGEND_TIERS.map(({ tier, text }) => (
              <li key={tier} className="flex items-center gap-2">
                <span className={`rent-map-swatch rent-map-pin--${tier}`} aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className="rent-map-swatch rent-map-context-swatch" aria-hidden="true">
                <span />
              </span>
              <span>Illustrative city-wide context: the city has an existing High or Severe rating</span>
            </li>
          </ul>
          <p className="mt-3 text-zinc-400 font-sans leading-relaxed">
            A red diamond ring sits at the approximate city center. It is not a neighborhood boundary or a verified
            danger claim, and it never changes a deal pin&apos;s color. Savings are shown separately from the score. Unverified
            Scout search hits have no known position or score, so they are not on the map.
          </p>
          {contextMarkers.length > 0 && (
            <p className="mt-2 text-zinc-400 font-sans">
              Context markers shown:{' '}
              {contextMarkers.map((marker) => `${marker.cityName} (${marker.rating})`).join(', ')}.
            </p>
          )}
        </div>

        <div role="group" aria-labelledby="radar-map-list-heading">
          <h4 id="radar-map-list-heading" className="text-xs font-bold text-zinc-200 uppercase mb-2">
            Mapped listings ({plotted.length})
          </h4>
          {plotted.length > 0 ? (
            <MappedListingList plotted={plotted} onSelect={onSelectListing} />
          ) : (
            <p className="border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 font-sans">
              No listings to map for the current filters.
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-zinc-400 font-sans">
        Map library: Leaflet, BSD 2-Clause.{' '}
        <a
          href={`${import.meta.env.BASE_URL}${LEAFLET_LICENSE_FILE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Leaflet license notice
        </a>
      </p>
    </section>
  );
};
