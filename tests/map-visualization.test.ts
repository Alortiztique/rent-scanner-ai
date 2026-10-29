// Offline checks for the Radar Map: the sourced approximate positions (src/data/mapCoordinates.ts) and
// the pure map policy (src/components/Map/mapModel.ts), plus static server renders of RentMap and App.
// No network, tile server, provider, or .env file is involved, and Leaflet itself is never loaded.
// The data and components load through an in-process Vite SSR loader that reads no .env file, like
// tests/fair-rent-calculator.test.ts.
// These checks cover coordinate coverage and validity, the score tiers and their boundaries, the
// plotted/omitted split, city context markers, the view that is chosen, the tile source constants,
// that App still loads and renders on the server with Leaflet kept out of the module graph, and the
// markup RentMap renders before any browser code runs. They do not click, press keys, focus, or lay
// anything out, and a static render shows nothing of the Leaflet map itself (pins, tiles,
// attribution control, stacking, tile errors, StrictMode cleanup, touch). Those need a real browser.
// Run: node --experimental-strip-types --test tests/map-visualization.test.ts
import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { City, Listing } from '../src/types/index.ts';

// Placeholders for the app's build-time settings, as in the other App render tests. Not real keys.
process.env.VITE_NEBIUS_API_KEY = 'offline-test-placeholder-not-a-key';
process.env.VITE_NEBIUS_BASE_URL = 'https://nebius.invalid/v1';

globalThis.fetch = (() => {
  throw new Error('real network access is disabled in map tests');
}) as typeof fetch;

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  mock.method(console, method, () => {});
}

type ModelModule = typeof import('../src/components/Map/mapModel.ts');
type CoordinatesModule = typeof import('../src/data/mapCoordinates.ts');
type MapModule = typeof import('../src/components/Map/RentMap.tsx');
type AppModule = typeof import('../src/App.tsx');
type CopilotModule = typeof import('../src/components/NemotronCopilot.tsx');
type FramingMap = import('../src/components/Map/mapModel.ts').FramingMap;

const root = fileURLToPath(new URL('..', import.meta.url));

let server: ViteDevServer;
let CITIES: City[];
let MOCK_LISTINGS: Listing[];
let model: ModelModule;
let coordinates: CoordinatesModule;
let mapModule: MapModule;
let app: AppModule;
let copilotModule: CopilotModule;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    envDir: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  ({ CITIES } = (await server.ssrLoadModule('/src/data/cities.ts')) as { CITIES: City[] });
  ({ MOCK_LISTINGS } = (await server.ssrLoadModule('/src/data/mockListings.ts')) as { MOCK_LISTINGS: Listing[] });
  model = (await server.ssrLoadModule('/src/components/Map/mapModel.ts')) as ModelModule;
  coordinates = (await server.ssrLoadModule('/src/data/mapCoordinates.ts')) as CoordinatesModule;
  mapModule = (await server.ssrLoadModule('/src/components/Map/RentMap.tsx')) as MapModule;
  app = (await server.ssrLoadModule('/src/App.tsx')) as AppModule;
  copilotModule = (await server.ssrLoadModule('/src/components/NemotronCopilot.tsx')) as CopilotModule;
});

after(async () => {
  mock.restoreAll();
  await server.close();
});

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const listingById = (id: string) => {
  const listing = MOCK_LISTINGS.find((l) => l.id === id);
  assert.ok(listing, `fixture ${id}`);
  return listing;
};
const withScore = (listing: Listing, dealScore: number, savingsPercentage = listing.savingsPercentage): Listing => ({
  ...listing,
  dealScore,
  savingsPercentage,
});

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------------------------
// Sourced approximate positions

test('all eight cities and all eleven fixtures have a valid, distinct, sourced position, and nothing else does', () => {
  const { CITY_POSITIONS, LISTING_POSITIONS } = coordinates;
  assert.equal(CITIES.length, 8);
  assert.equal(MOCK_LISTINGS.length, 11);
  assert.deepEqual(Object.keys(CITY_POSITIONS).sort(), CITIES.map((c) => c.id).sort());
  assert.deepEqual(Object.keys(LISTING_POSITIONS).sort(), MOCK_LISTINGS.map((l) => l.id).sort());

  const all = [...Object.entries(CITY_POSITIONS), ...Object.entries(LISTING_POSITIONS)];
  for (const [id, position] of all) {
    assert.ok(model.isValidGeoPoint(position), `${id} has a finite, in-range latitude and longitude`);
    assert.match(position.osm, /^(node|way|relation)\/\d+$/, `${id} names the OpenStreetMap object it came from`);
  }
  const places = new Set(all.map(([, p]) => `${p.lat},${p.lng}`));
  assert.equal(places.size, all.length, 'no two positions are the same point, so nothing needs jitter');
  const sources = new Set(all.map(([, p]) => p.osm));
  assert.equal(sources.size, all.length, 'no two positions copy the same source object');
});

test('each fixture lies near its own city and far from every other city (catches swapped or pasted values)', () => {
  const { CITY_POSITIONS, LISTING_POSITIONS } = coordinates;
  for (const listing of MOCK_LISTINGS) {
    const own = distanceKm(LISTING_POSITIONS[listing.id], CITY_POSITIONS[listing.cityId]);
    assert.ok(own < 25, `${listing.id} is ${own.toFixed(1)} km from ${listing.cityId}`);
    for (const city of CITIES.filter((c) => c.id !== listing.cityId)) {
      const other = distanceKm(LISTING_POSITIONS[listing.id], CITY_POSITIONS[city.id]);
      assert.ok(other > 300, `${listing.id} is only ${other.toFixed(0)} km from ${city.id}`);
    }
  }
});

test('every fixture stays on screen at the city zoom on a 320 px wide phone, with room for its pin', () => {
  // Web Mercator pixel offset from the city center at the zoom the selected-city view uses.
  const world = 256 * 2 ** model.CITY_ZOOM;
  const project = ({ lat, lng }: { lat: number; lng: number }) => ({
    x: ((lng + 180) / 360) * world,
    y: (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * world,
  });
  // The map is 20rem (320 px) tall below the sm breakpoint. A pin is 40 px, so 20 px must stay free.
  const halfWidth = 320 / 2 - 20;
  const halfHeight = 320 / 2 - 20;
  for (const listing of MOCK_LISTINGS) {
    const center = project(coordinates.CITY_POSITIONS[listing.cityId]);
    const pin = project(coordinates.LISTING_POSITIONS[listing.id]);
    assert.ok(Math.abs(pin.x - center.x) <= halfWidth, `${listing.id} fits horizontally`);
    assert.ok(Math.abs(pin.y - center.y) <= halfHeight, `${listing.id} fits vertically`);
  }
});

test('the all-cities view can zoom out far enough to frame every fixture on a 320 px wide phone', () => {
  // The zoom Leaflet's fitBounds picks (whole levels) for the bounds of all fixtures in a 320 px map
  // with the view's padding on each side. It must not be below the lowest zoom the map allows,
  // or the outer pins (San Francisco, Tokyo) would sit outside the map.
  const lats = MOCK_LISTINGS.map((l) => coordinates.LISTING_POSITIONS[l.id].lat);
  const lngs = MOCK_LISTINGS.map((l) => coordinates.LISTING_POSITIONS[l.id].lng);
  const mercatorY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
  const spanX = (Math.max(...lngs) - Math.min(...lngs)) / 360;
  const spanY = mercatorY(Math.min(...lats)) - mercatorY(Math.max(...lats));
  const available = 320 - 2 * model.FIT_PADDING_PX;
  const zoomFor = (span: number) => Math.log2(available / (256 * span));
  const fitZoom = Math.floor(Math.min(zoomFor(spanX), zoomFor(spanY)));
  assert.ok(fitZoom >= model.MAP_MIN_ZOOM, `frames at zoom ${fitZoom}, but the lowest allowed zoom is ${model.MAP_MIN_ZOOM}`);
  assert.ok(fitZoom < model.CITY_ZOOM, 'a world view is wider than a city view');
});

// ---------------------------------------------------------------------------------------------
// Coordinate validation

test('isValidGeoPoint accepts finite in-range points including the edges and (0, 0)', () => {
  for (const point of [
    { lat: 0, lng: 0 },
    { lat: 90, lng: 180 },
    { lat: -90, lng: -180 },
    { lat: 40.7127281, lng: -74.0060152 },
    { lat: 4.65, lng: -74.08, osm: 'relation/1' },
  ]) {
    assert.equal(model.isValidGeoPoint(point), true, JSON.stringify(point));
  }
});

test('isValidGeoPoint rejects non-finite, out-of-range, mistyped and missing values', () => {
  for (const point of [
    { lat: NaN, lng: 0 },
    { lat: 0, lng: NaN },
    { lat: Infinity, lng: 0 },
    { lat: 0, lng: -Infinity },
    { lat: 90.0001, lng: 0 },
    { lat: -90.0001, lng: 0 },
    { lat: 0, lng: 180.0001 },
    { lat: 0, lng: -180.0001 },
    { lat: '40.7', lng: -74 },
    { lat: 40.7, lng: '-74' },
    { lat: true, lng: false },
    { lat: null, lng: null },
    { lat: 40.7 },
    { lng: -74 },
    {},
    [40.7, -74],
    null,
    undefined,
    '40.7,-74',
    42,
  ]) {
    assert.equal(model.isValidGeoPoint(point), false, JSON.stringify(point) ?? String(point));
  }
});

// ---------------------------------------------------------------------------------------------
// Score tiers

test('score tiers: green from 90, amber from 75 up to 90, neutral below 75', () => {
  const cases: Array<[number, 'green' | 'amber' | 'neutral']> = [
    [100, 'green'],
    [90, 'green'],
    [89.99, 'amber'],
    [89, 'amber'],
    [75, 'amber'],
    [74.99, 'neutral'],
    [74, 'neutral'],
    [0, 'neutral'],
  ];
  for (const [score, tier] of cases) assert.equal(model.scoreTier(score), tier, String(score));
});

test('a missing, non-finite, mistyped or out-of-range score is neutral and never green', () => {
  for (const score of [NaN, Infinity, -Infinity, undefined, null, '95', '', -1, 100.01, 1000, {}]) {
    assert.equal(model.scoreTier(score), 'neutral', String(score));
    assert.equal(model.hasUsableScore(score), false, String(score));
    assert.equal(model.formatScore(score), 'n/a', String(score));
  }
  const label = model.pinLabel(withScore(listingById('nyc-sublet-01'), NaN));
  assert.match(label, /Deal score unavailable, neutral tier/);
  assert.doesNotMatch(label, /green|amber/);
});

test('the fixtures land in the expected tiers: ten green and one amber', () => {
  const tiers = MOCK_LISTINGS.map((l) => model.scoreTier(l.dealScore));
  assert.equal(tiers.filter((t) => t === 'green').length, 10);
  assert.deepEqual(
    MOCK_LISTINGS.filter((l) => model.scoreTier(l.dealScore) === 'amber').map((l) => l.id),
    ['london-sublet-02'],
  );
});

test('savings are shown on their own and never decide the tier', () => {
  const base = listingById('nyc-sublet-01');
  const lowScoreBigSavings = withScore(base, 60, 90);
  assert.equal(model.scoreTier(lowScoreBigSavings.dealScore), 'neutral');
  assert.match(model.pinLabel(lowScoreBigSavings), /90% below the demo reference rent/);

  const highScoreSmallSavings = withScore(base, 95, 10);
  assert.equal(model.scoreTier(highScoreSmallSavings.dealScore), 'green');
  const label = model.pinLabel(highScoreSmallSavings);
  assert.match(label, /Deal score 95 of 100, green tier \(90 or higher\)/);
  assert.match(label, /10% below the demo reference rent/);

  assert.match(model.pinLabel(withScore(base, 80, NaN)), /Savings unavailable/);
  assert.match(model.pinLabel(withScore(base, 80, -5)), /5% above the demo reference rent/);
});

test('every pin name is unique, names the listing and its tier, and says the position is approximate', () => {
  const labels = MOCK_LISTINGS.map((l) => model.pinLabel(l));
  assert.equal(new Set(labels).size, labels.length);
  MOCK_LISTINGS.forEach((listing, index) => {
    assert.ok(labels[index].startsWith(listing.title));
    assert.ok(labels[index].includes(listing.cityName));
    assert.ok(labels[index].includes(`${listing.dealScore} of 100`));
    assert.ok(labels[index].endsWith('Approximate demo position, not a property address.'));
    assert.doesNotMatch(labels[index], /address(?!\.$)/, 'the word address appears only in the disclaimer');
  });
});

// ---------------------------------------------------------------------------------------------
// Plotted and omitted listings

test('splitting keeps the input order and accounts for every listing', () => {
  const reordered = [...MOCK_LISTINGS].sort((a, b) => a.priceUsd - b.priceUsd);
  const { plotted, omitted } = model.splitListingsByPosition(reordered, coordinates.LISTING_POSITIONS);
  assert.deepEqual(
    plotted.map((p) => p.listing.id),
    reordered.map((l) => l.id),
  );
  assert.equal(omitted.length, 0);
  for (const entry of plotted) {
    assert.equal(entry.tier, model.scoreTier(entry.listing.dealScore));
    assert.deepEqual(entry.point, {
      lat: coordinates.LISTING_POSITIONS[entry.listing.id].lat,
      lng: coordinates.LISTING_POSITIONS[entry.listing.id].lng,
    });
  }
});

test('listings with a missing or invalid position are omitted with their id and title, and the rest still plot', () => {
  const [a, b, c, d, e] = MOCK_LISTINGS;
  const positions = {
    [a.id]: { lat: NaN, lng: 10 },
    [b.id]: { lat: 91, lng: 10 },
    [c.id]: { lat: '40.7', lng: '-74' },
    [d.id]: { lat: 0, lng: 0 },
    // e has no entry at all
  };
  const { plotted, omitted } = model.splitListingsByPosition([a, b, c, d, e], positions);
  assert.deepEqual(
    omitted.map((l) => [l.id, l.title]),
    [a, b, c, e].map((l) => [l.id, l.title]),
  );
  assert.deepEqual(
    plotted.map((p) => p.listing.id),
    [d.id],
    '(0, 0) is a real point, so it is not mistaken for a missing one',
  );
  assert.equal(plotted.length + omitted.length, 5);
});

test('a position is read from the table\'s own keys only, never from an inherited property', () => {
  const base = listingById('nyc-sublet-01');
  const hostile = ['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((id) => ({ ...base, id }));
  const real = model.splitListingsByPosition(hostile, coordinates.LISTING_POSITIONS);
  assert.equal(real.plotted.length, 0);
  assert.equal(real.omitted.length, 4);

  // A table that inherits a perfectly valid point for an id must still not supply it.
  const point = { lat: 10, lng: 20 };
  const inherited = Object.create({ [base.id]: point, [base.cityId]: point }) as Record<string, unknown>;
  assert.equal(model.splitListingsByPosition([base], inherited).plotted.length, 0);
  assert.equal(model.cityContextMarkers(CITIES, 'all', inherited).length, 0);
  assert.notEqual(model.planMapView(base.cityId, [], inherited).key, `city:${base.cityId}`);
});

test('a pin signature changes when anything a pin shows changes', () => {
  const base = listingById('nyc-sublet-01');
  const signatureOf = (listing: Listing, positions = coordinates.LISTING_POSITIONS) =>
    model.splitListingsByPosition([listing], positions).plotted[0].signature;
  const original = signatureOf(base);
  assert.equal(signatureOf({ ...base }), original, 'an equal listing keeps the same signature');
  assert.notEqual(signatureOf(withScore(base, 80)), original, 'score');
  assert.notEqual(signatureOf({ ...base, title: 'Another title' }), original, 'label');
  assert.notEqual(signatureOf(base, { [base.id]: { lat: 1, lng: 2 } }), original, 'position');
});

// ---------------------------------------------------------------------------------------------
// City context markers

test('red context follows the existing High and Severe ratings, derived from the city data', () => {
  const expected = CITIES.filter((c) => c.gentrificationRating === 'High' || c.gentrificationRating === 'Severe')
    .map((c) => c.id)
    .sort();
  const shown = model.cityContextMarkers(CITIES, 'all', coordinates.CITY_POSITIONS);
  assert.deepEqual(shown.map((m) => m.cityId).sort(), expected);
  assert.deepEqual(expected, ['berlin', 'bogota', 'dubai', 'london', 'nyc', 'paris', 'sf']);
  assert.ok(!shown.some((m) => m.cityId === 'tokyo'), 'Tokyo is Moderate and has no warning');
  for (const marker of shown) {
    assert.ok(marker.description.includes(marker.cityName));
    assert.ok(marker.description.includes(marker.rating));
    assert.ok(marker.description.includes('approximate city center'));
  }
});

test('changing a city rating changes its marker, so the list is not hard-coded', () => {
  const edited = CITIES.map((c) =>
    c.id === 'tokyo'
      ? { ...c, gentrificationRating: 'Severe' as const }
      : c.id === 'nyc'
        ? { ...c, gentrificationRating: 'Moderate' as const }
        : c,
  );
  const ids = model.cityContextMarkers(edited, 'all', coordinates.CITY_POSITIONS).map((m) => m.cityId);
  assert.ok(ids.includes('tokyo'));
  assert.ok(!ids.includes('nyc'));
});

test('a selected city shows only its own context marker, and none when it is Moderate or unknown', () => {
  const only = (cityId: string) => model.cityContextMarkers(CITIES, cityId, coordinates.CITY_POSITIONS).map((m) => m.cityId);
  assert.deepEqual(only('bogota'), ['bogota']);
  assert.deepEqual(only('sf'), ['sf']);
  assert.deepEqual(only('tokyo'), []);
  assert.deepEqual(only('atlantis'), []);
  assert.deepEqual(only(''), []);
});

test('a city without a valid center position gets no context marker', () => {
  const positions = { ...coordinates.CITY_POSITIONS, nyc: { lat: NaN, lng: 0 } };
  const ids = model.cityContextMarkers(CITIES, 'all', positions).map((m) => m.cityId);
  assert.ok(!ids.includes('nyc'));
  assert.equal(ids.length, 6);
});

// ---------------------------------------------------------------------------------------------
// The view that is chosen

const plottedFor = (listings: Listing[]) =>
  model.splitListingsByPosition(listings, coordinates.LISTING_POSITIONS).plotted;
const cityPoint = (id: string) => ({ lat: coordinates.CITY_POSITIONS[id].lat, lng: coordinates.CITY_POSITIONS[id].lng });

test('a selected city is centered at the city zoom even when it has no matching listing', () => {
  for (const city of CITIES) {
    const plan = model.planMapView(city.id, [], coordinates.CITY_POSITIONS);
    assert.equal(plan.kind, 'center', city.id);
    if (plan.kind === 'center') {
      assert.deepEqual(plan.center, cityPoint(city.id), city.id);
      assert.equal(plan.zoom, model.CITY_ZOOM, city.id);
    }
  }
  // With listings the city center still wins, so the view does not jump as filters change.
  const nyc = plottedFor(MOCK_LISTINGS.filter((l) => l.cityId === 'nyc'));
  assert.equal(nyc.length, 2);
  const withListings = model.planMapView('nyc', nyc, coordinates.CITY_POSITIONS);
  const without = model.planMapView('nyc', [], coordinates.CITY_POSITIONS);
  assert.deepEqual(withListings, without);
});

test('all cities with several listings frames exactly the listing positions, not the context markers', () => {
  const plan = model.planMapView('all', plottedFor(MOCK_LISTINGS), coordinates.CITY_POSITIONS);
  assert.equal(plan.kind, 'bounds');
  if (plan.kind !== 'bounds') return;
  const framed = plan.points.map((p) => `${p.lat},${p.lng}`).sort();
  const listings = MOCK_LISTINGS.map((l) => `${coordinates.LISTING_POSITIONS[l.id].lat},${coordinates.LISTING_POSITIONS[l.id].lng}`).sort();
  assert.deepEqual(framed, listings);
});

test('all cities with one listing uses a capped close zoom, not the closest', () => {
  const plan = model.planMapView('all', plottedFor([listingById('bogota-sublet-02')]), coordinates.CITY_POSITIONS);
  assert.equal(plan.kind, 'center');
  if (plan.kind !== 'center') return;
  assert.deepEqual(plan.center, {
    lat: coordinates.LISTING_POSITIONS['bogota-sublet-02'].lat,
    lng: coordinates.LISTING_POSITIONS['bogota-sublet-02'].lng,
  });
  assert.ok(plan.zoom >= 10 && plan.zoom <= model.CLOSE_ZOOM_CAP && plan.zoom < model.MAP_MAX_ZOOM);

  // Two listings that share one point are one point, so they must not ask for a bounds fit.
  const base = listingById('nyc-sublet-01');
  const twins = [base, { ...base, id: 'twin' }];
  const shared = { [base.id]: { lat: 10, lng: 20 }, twin: { lat: 10, lng: 20 } };
  const twinPlan = model.planMapView('all', model.splitListingsByPosition(twins, shared).plotted, coordinates.CITY_POSITIONS);
  assert.equal(twinPlan.kind, 'center');
});

test('all cities with no listing falls back to the eight city center points', () => {
  for (const cityId of ['all', 'atlantis']) {
    const plan = model.planMapView(cityId, [], coordinates.CITY_POSITIONS);
    assert.equal(plan.kind, 'bounds', cityId);
    if (plan.kind !== 'bounds') continue;
    assert.equal(plan.points.length, 8, cityId);
    assert.deepEqual(
      plan.points.map((p) => `${p.lat},${p.lng}`).sort(),
      CITIES.map((c) => `${cityPoint(c.id).lat},${cityPoint(c.id).lng}`).sort(),
      cityId,
    );
  }
  // No usable position anywhere still yields a defined view.
  const none = model.planMapView('all', [], {});
  assert.equal(none.kind, 'center');
});

test('an unknown selected city still frames the listings it is given, and a bad city center is skipped', () => {
  const some = plottedFor([listingById('nyc-sublet-01'), listingById('sf-sublet-01')]);
  assert.equal(model.planMapView('atlantis', some, coordinates.CITY_POSITIONS).kind, 'bounds');
  const brokenCenter = { ...coordinates.CITY_POSITIONS, nyc: { lat: 200, lng: 0 } };
  assert.equal(model.planMapView('nyc', some, brokenCenter).kind, 'bounds');
});

test('the view key names the framing: stable for the same view, different for another', () => {
  const key = (cityId: string, listings: Listing[]) =>
    model.planMapView(cityId, plottedFor(listings), coordinates.CITY_POSITIONS).key;
  const some = [listingById('nyc-sublet-01'), listingById('sf-sublet-01'), listingById('tokyo-sublet-01')];
  assert.equal(key('all', some), key('all', [...some].reverse()), 'sort order does not change the view');
  assert.notEqual(key('all', some), key('all', some.slice(0, 2)));
  assert.notEqual(key('all', some), key('nyc', some));
  assert.equal(key('nyc', some), key('nyc', some.slice(0, 1)), 'filters inside a city do not move the view');
  assert.notEqual(key('nyc', []), key('london', []));
});

// ---------------------------------------------------------------------------------------------
// Tile source

test('the basemap uses the exact public OpenStreetMap endpoint with a visible, linked credit and no key', () => {
  assert.equal(model.OSM_TILE_URL, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.doesNotMatch(model.OSM_TILE_URL, /[?&=]/, 'no query string, key, or cache-busting parameter');
  assert.equal(model.OSM_COPYRIGHT_URL, 'https://www.openstreetmap.org/copyright');
  const link = model.OSM_ATTRIBUTION_HTML.match(/^&copy; <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
  assert.ok(link, 'the attribution is a copyright sign and one link');
  assert.equal(link[1], model.OSM_COPYRIGHT_URL);
  assert.equal(link[2], 'OpenStreetMap contributors');
  assert.doesNotMatch(model.OSM_ATTRIBUTION_HTML, /referrerpolicy|noreferrer.*referrer/i);
});

// ---------------------------------------------------------------------------------------------
// Server rendering: Leaflet stays out of the eager and server path

test('App and RentMap load and render on the server with no window, and Leaflet is only a dynamic import', async () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');

  const sourceUrls = [...server.moduleGraph.urlToModuleMap.keys()].filter((url) => url.startsWith('/src/'));
  assert.ok(sourceUrls.includes('/src/components/Map/RentMap.tsx'), 'App reaches RentMap');
  for (const url of sourceUrls) {
    const result = await server.transformRequest(url, { ssr: true });
    const staticDeps = result?.deps ?? [];
    assert.ok(!staticDeps.some((dep) => /leaflet/.test(dep)), `${url} must not import Leaflet statically`);
  }
  const map = await server.transformRequest('/src/components/Map/RentMap.tsx', { ssr: true });
  assert.ok(
    (map?.dynamicDeps ?? []).includes('leaflet'),
    'RentMap loads Leaflet with a dynamic import, from an effect that never runs on the server',
  );
});

test('App opens on Grid with an accessible Grid / Radar map toggle and no map in the markup', () => {
  const markup = renderToStaticMarkup(createElement(app.App));
  assert.match(markup, /<div[^>]*role="group"[^>]*aria-label="Demo fixture listings view"/);
  const toggles = [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => [
    m[1],
    textOf(m[2]),
  ]);
  assert.deepEqual(toggles, [
    ['true', 'Grid'],
    ['false', 'Radar map'],
  ]);
  assert.equal((markup.match(/data-fair-rent="card"/g) ?? []).length, 11, 'the grid shows all eleven cards');
  assert.doesNotMatch(markup, /rent-map|radar-map-heading|leaflet/i);
  assert.doesNotMatch(markup, /NaN|Infinity/);
});

// ---------------------------------------------------------------------------------------------
// The markup RentMap renders before the browser takes over

const renderMap = (listings: readonly Listing[], selectedCityId = 'all', onSelectListing: (l: Listing) => void = () => {}) =>
  renderToStaticMarkup(createElement(mapModule.RentMap, { listings, selectedCityId, onSelectListing }));

test('RentMap names its region, says positions are approximate, and explains the legend', () => {
  const markup = renderMap(MOCK_LISTINGS);
  const text = textOf(markup);
  assert.match(markup, /<div[^>]*role="region"[^>]*aria-label="Radar map of demo fixture listings\. Approximate demo positions, not property addresses\."/);
  assert.match(text, /Radar map \(11 of 11 mapped\)/);
  assert.ok(text.includes('Approximate demo position, not a property address.'));
  assert.ok(text.includes('neighborhood-scale points, not actual homes or named stops'));
  assert.ok(text.includes('Deal score 90 or higher'));
  assert.ok(text.includes('Deal score 75 to 89'));
  assert.ok(text.includes('Deal score below 75, or unavailable'));
  assert.ok(text.includes('Illustrative city-wide context'));
  assert.ok(text.includes('not a neighborhood boundary or a verified danger claim'));
  assert.ok(text.includes('never changes a deal pin'));
  assert.ok(text.includes('Savings are shown separately from the score'));
  assert.ok(text.includes('Scout search hits have no known position or score, so they are not on the map'));
  assert.doesNotMatch(text, />\s*40\s*%|stealth/i, 'no savings-based score rule');
  assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
});

test('RentMap lists every mapped listing as a native button, in the given order, with its score and savings', () => {
  const ordered = [...MOCK_LISTINGS].sort((a, b) => a.priceUsd - b.priceUsd);
  const markup = renderMap(ordered);
  const list = markup.match(/<ul class="max-h-72[^>]*>(.*?)<\/ul>/s);
  assert.ok(list, 'the compact list is present');
  const buttons = [...list[1].matchAll(/<button type="button"[^>]*>(.*?)<\/button>/gs)].map((m) => textOf(m[1]));
  assert.equal(buttons.length, 11);
  assert.equal(new Set(buttons).size, 11, 'no two buttons share a name');
  ordered.forEach((listing, index) => {
    assert.ok(buttons[index].includes(textOf(escapeHtml(listing.title))), `${listing.id} is named by its title`);
    assert.ok(buttons[index].startsWith(String(listing.dealScore)), `${listing.id} shows its score`);
    assert.ok(buttons[index].includes(`-${listing.savingsPercentage}% MKT`), `${listing.id} shows its savings`);
  });
});

test('the context text lists the High and Severe cities for all cities, only the selected one otherwise, and nothing for Tokyo', () => {
  const allText = textOf(renderMap(MOCK_LISTINGS, 'all'));
  assert.match(allText, /Context markers shown: .*New York City \(Severe\)/);
  for (const [name, rating] of [
    ['London', 'Severe'],
    ['Paris', 'Severe'],
    ['Berlin', 'Severe'],
    ['San Francisco', 'Severe'],
    ['Bogotá', 'High'],
    ['Dubai', 'High'],
  ]) {
    assert.ok(allText.includes(`${name} (${rating})`), name);
  }
  assert.ok(!allText.includes('Tokyo ('), 'Tokyo has no marker');

  const bogota = textOf(renderMap(MOCK_LISTINGS.filter((l) => l.cityId === 'bogota'), 'bogota'));
  assert.match(bogota, /Context markers shown: Bogotá \(High\)\./);

  assert.doesNotMatch(textOf(renderMap(MOCK_LISTINGS.filter((l) => l.cityId === 'tokyo'), 'tokyo')), /Context markers shown/);
});

test('RentMap reports omitted listings and keeps the rest mapped', () => {
  const base = listingById('nyc-sublet-01');
  const stray = { ...base, id: 'no-position-1', title: 'Listing with no position' };
  const text = textOf(renderMap([...MOCK_LISTINGS.slice(0, 3), stray]));
  assert.match(text, /Radar map \(3 of 4 mapped\)/);
  assert.match(text, /1 listing has no valid approximate position and is not on the map\. Use Grid view to open it\./);
  assert.ok(!text.includes('Listing with no position'), 'the unmapped listing is not in the mapped list');

  const two = textOf(renderMap([stray, { ...stray, id: 'no-position-2' }]));
  assert.match(two, /2 listings have no valid approximate position and are not on the map\. Use Grid view to open them\./);
  assert.doesNotMatch(textOf(renderMap(MOCK_LISTINGS)), /no valid approximate position/);
});

test('RentMap renders with no listings, for every selected city, without throwing', () => {
  for (const cityId of ['all', 'atlantis', ...CITIES.map((c) => c.id)]) {
    const text = textOf(renderMap([], cityId));
    assert.match(text, /Radar map \(0 of 0 mapped\)/, cityId);
    assert.ok(text.includes('No listings to map for the current filters.'), cityId);
  }
});

test('listing titles are rendered as text, never as markup', () => {
  const hostile = { ...listingById('nyc-sublet-01'), title: '<img src=x onerror="window.__pwned=1">' };
  const markup = renderMap([hostile]);
  assert.doesNotMatch(markup, /<img[^>]*src=x/);
  assert.ok(markup.includes('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;'));
});

// ---------------------------------------------------------------------------------------------
// Selection wiring (no DOM): the list is hook-free, so it is called as a function and its props invoked

function findElements(node: ReactNode, match: (element: ReactElement<any>) => boolean, found: ReactElement<any>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, match, found);
  } else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (match(element)) found.push(element);
    findElements(element.props.children, match, found);
  }
  return found;
}

test('each list button opens the dossier for exactly its own listing (callback wiring)', () => {
  const plotted = plottedFor(MOCK_LISTINGS);
  const selected: Listing[] = [];
  const tree = mapModule.MappedListingList({ plotted, onSelect: (l) => selected.push(l) });
  const buttons = findElements(tree, (el) => el.type === 'button');
  assert.equal(buttons.length, 11);
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(
    selected.map((l) => l.id),
    MOCK_LISTINGS.map((l) => l.id),
  );
  assert.ok(selected.every((l, i) => l === MOCK_LISTINGS[i]), 'the exact fixture object is passed on');
});

// ---------------------------------------------------------------------------------------------
// Basemap tile failures: the notice follows the tiles that are failed, not the last event

test('a tile that loads does not clear the notice while another tile is still failed', () => {
  const states: boolean[] = [];
  const tracker = model.createTileFailureTracker((failed) => states.push(failed));
  const [a, b, c] = [{}, {}, {}];
  // The order a flaky server gives: fail, ok, fail, ok.
  tracker.fail(a);
  tracker.release(b); // a different tile loaded
  tracker.fail(c);
  tracker.release({}); // and another
  assert.deepEqual(states, [true], 'the notice came up once and no load took it down');
  tracker.release(a);
  assert.deepEqual(states, [true], 'one failed tile is still on the layer');
  tracker.release(c);
  assert.deepEqual(states, [true, false], 'the notice goes when the last failed tile is gone');
});

test('a failed tile that is unloaded, or that later loads, no longer counts', () => {
  const states: boolean[] = [];
  const tracker = model.createTileFailureTracker((failed) => states.push(failed));
  const tile = {};
  tracker.fail(tile);
  tracker.fail(tile); // the same element reporting again is still one failed tile
  tracker.release(tile); // tileunload: the user panned or zoomed it away
  assert.deepEqual(states, [true, false]);
  tracker.release(tile); // an unload after a load is not a second recovery
  assert.deepEqual(states, [true, false]);
  tracker.fail(tile);
  tracker.release(tile); // tileload for the same element
  assert.deepEqual(states, [true, false, true, false]);
});

test('the failed set holds only tiles that are failed, so it cannot outgrow the tiles on the layer', () => {
  const states: boolean[] = [];
  const tracker = model.createTileFailureTracker((failed) => states.push(failed));
  // 1,000 tiles fail and are each unloaded in turn, as a long pan would do.
  for (let i = 0; i < 1000; i++) {
    const tile = {};
    tracker.fail(tile);
    tracker.release(tile);
  }
  assert.equal(states.length, 2000, 'one report per change');
  assert.equal(states.at(-1), false);
  // Nothing is left behind: a tile loading now has nothing to clear and reports nothing.
  tracker.release({});
  assert.equal(states.length, 2000);
});

// ---------------------------------------------------------------------------------------------
// Framing follows the map's size

interface FakeCall {
  op: 'setView' | 'fitBounds';
  animate: boolean;
  args: unknown[];
}

/** A map whose size Leaflet only learns in invalidateSize, like the real one. */
function fakeFramingMap(width: number, height: number) {
  let real = { x: width, y: height };
  let known = { ...real };
  const calls: FakeCall[] = [];
  const map: FramingMap = {
    getSize: () => ({ ...known }),
    invalidateSize: () => {
      known = { ...real };
    },
    setView: (center, zoom, options) => {
      calls.push({ op: 'setView', animate: options.animate, args: [center, zoom] });
    },
    fitBounds: (bounds, options) => {
      calls.push({ op: 'fitBounds', animate: options.animate, args: [bounds, options.padding, options.maxZoom] });
    },
  };
  return {
    map,
    calls,
    /** The container changes size and nothing has told the map yet. */
    resizeTo(x: number, y: number) {
      real = { x, y };
    },
    /** What Leaflet's own window resize handler does, before any observer of ours runs. */
    leafletNoticesResize() {
      known = { ...real };
    },
  };
}

const allCitiesPlan = () => model.planMapView('all', plottedFor(MOCK_LISTINGS), coordinates.CITY_POSITIONS);
const londonPlan = () =>
  model.planMapView('london', plottedFor(MOCK_LISTINGS.filter((l) => l.cityId === 'london')), coordinates.CITY_POSITIONS);

test('a plan is applied once, so a render that changes nothing never resets the view', () => {
  const fake = fakeFramingMap(1220, 476);
  const framer = model.createMapFramer(fake.map);
  framer.show(allCitiesPlan(), true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, 'fitBounds');
  assert.equal(fake.calls[0].animate, false, 'the first view is placed in one step');
  // A dossier opening, a pay edit or a new listings array produces an equal plan with the same key.
  framer.show(allCitiesPlan(), true);
  framer.show(allCitiesPlan(), true);
  assert.equal(fake.calls.length, 1);
});

test('a later plan animates only if motion is allowed', () => {
  for (const [allowMotion, expected] of [
    [true, true],
    [false, false],
  ] as const) {
    const fake = fakeFramingMap(1220, 476);
    const framer = model.createMapFramer(fake.map);
    framer.show(allCitiesPlan(), allowMotion);
    framer.show(londonPlan(), allowMotion);
    assert.deepEqual(
      fake.calls.map((c) => [c.op, c.animate]),
      [
        ['fitBounds', false],
        ['setView', expected],
      ],
    );
  }
});

test('narrowing the map frames the current plan again, with no animation', () => {
  const fake = fakeFramingMap(1220, 476);
  const framer = model.createMapFramer(fake.map);
  framer.show(allCitiesPlan(), true);

  for (const [width, height] of [
    [354, 316], // a 390 px phone
    [324, 316], // a 360 px phone
    [1220, 476], // and back to desktop
  ]) {
    fake.resizeTo(width, height);
    framer.resize();
  }
  assert.equal(fake.calls.length, 4, 'one frame for the first view and one for each real size change');
  for (const call of fake.calls.slice(1)) {
    assert.equal(call.op, 'fitBounds');
    assert.equal(call.animate, false);
    assert.deepEqual(call.args, fake.calls[0].args, 'the same listing points, padding and cap are fitted again');
  }
});

test('the plan used after a resize is the latest one, not the one the map started with', () => {
  const fake = fakeFramingMap(1220, 476);
  const framer = model.createMapFramer(fake.map);
  framer.show(allCitiesPlan(), true);
  framer.show(londonPlan(), true);
  fake.resizeTo(354, 316);
  framer.resize();
  const last = fake.calls.at(-1)!;
  assert.equal(last.op, 'setView');
  assert.deepEqual(last.args[0], [coordinates.CITY_POSITIONS.london.lat, coordinates.CITY_POSITIONS.london.lng]);
  assert.equal(last.args[1], model.CITY_ZOOM);
  assert.equal(last.animate, false);
});

test('a resize Leaflet already noticed itself still frames the plan once, and an unchanged size does not', () => {
  const fake = fakeFramingMap(1220, 476);
  const framer = model.createMapFramer(fake.map);
  framer.show(allCitiesPlan(), true);
  // The window resize handler runs first and updates the map's size, so the size the observer reads
  // already equals the new one. A comparison against that size would see nothing to do.
  fake.resizeTo(354, 316);
  fake.leafletNoticesResize();
  framer.resize();
  assert.equal(fake.calls.length, 2, 'framed for the new size');
  // The observer firing again, or for a reason that is not a size change, must not touch a view the
  // user has since panned or zoomed, and must not start a loop.
  framer.resize();
  framer.resize();
  assert.equal(fake.calls.length, 2);
});

test('nothing is framed before a plan exists, and a map with no size is framed once it has one', () => {
  const fake = fakeFramingMap(1220, 476);
  const framer = model.createMapFramer(fake.map);
  fake.resizeTo(800, 476);
  framer.resize();
  assert.equal(fake.calls.length, 0, 'no plan yet');

  framer.show(allCitiesPlan(), true);
  fake.resizeTo(0, 0);
  framer.resize();
  assert.equal(fake.calls.length, 1, 'a hidden map has nothing to fit');
  fake.resizeTo(354, 316);
  framer.resize();
  assert.equal(fake.calls.length, 2);
});

test('the all-cities frame keeps every fixture inside the map at desktop, 390, 360 and 320 px wide, and back', () => {
  // Leaflet's fitBounds with whole zoom levels: the zoom is the largest one at which the listing
  // bounds fit the padded map, and the view centers on the bounds. Page padding and the map border
  // leave 354, 324 and 284 px of map for a 390, 360 and 320 px screen.
  const points = MOCK_LISTINGS.map((l) => coordinates.LISTING_POSITIONS[l.id]);
  const mercatorX = (lng: number, zoom: number) => ((lng + 180) / 360) * 256 * 2 ** zoom;
  const mercatorY = (lat: number, zoom: number) =>
    (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * 256 * 2 ** zoom;
  const fitZoom = (width: number, height: number) => {
    const xs = points.map((p) => mercatorX(p.lng, 0));
    const ys = points.map((p) => mercatorY(p.lat, 0));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min((width - 2 * model.FIT_PADDING_PX) / spanX, (height - 2 * model.FIT_PADDING_PX) / spanY);
    return Math.max(model.MAP_MIN_ZOOM, Math.min(model.CLOSE_ZOOM_CAP, Math.floor(Math.log2(scale))));
  };
  for (const [width, height] of [
    [1220, 476],
    [354, 316],
    [324, 316],
    [284, 316],
    [1220, 476],
  ]) {
    const zoom = fitZoom(width, height);
    const xs = points.map((p) => mercatorX(p.lng, zoom));
    const ys = points.map((p) => mercatorY(p.lat, zoom));
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    // A 40 px pin is centered on its point, so 20 px of it must stay on the map.
    MOCK_LISTINGS.forEach((listing, index) => {
      assert.ok(Math.abs(xs[index] - centerX) <= width / 2 - 20, `${listing.id} fits across ${width}px at zoom ${zoom}`);
      assert.ok(Math.abs(ys[index] - centerY) <= height / 2 - 20, `${listing.id} fits down ${height}px at zoom ${zoom}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Reduced motion

test('under reduced motion a pan is never animated, whatever options the caller passes', () => {
  const seen: Array<{ offset: [number, number]; options?: Record<string, unknown> }> = [];
  const fake = {
    panBy(offset: [number, number], options?: Record<string, unknown>) {
      seen.push({ offset, options });
      return 'result';
    },
  };
  const original = fake.panBy;
  model.disablePanAnimation(fake);
  assert.notEqual(fake.panBy, original, 'this one object is wrapped');

  // What Leaflet's arrow keys call, plain and with Shift: an offset and no options.
  assert.equal(fake.panBy([80, 0]), 'result', 'the return value is passed on');
  assert.equal(fake.panBy([0, -240]), 'result');
  // A caller that asks for an animation anyway, as drag inertia does, still gets none.
  fake.panBy([5, 5], { animate: true, duration: 0.5, noMoveStart: true });
  assert.deepEqual(seen, [
    { offset: [80, 0], options: { animate: false } },
    { offset: [0, -240], options: { animate: false } },
    { offset: [5, 5], options: { animate: false, duration: 0.5, noMoveStart: true } },
  ]);
});

test('disablePanAnimation changes only the map it is given, and the wrapped pan still runs on that map', () => {
  class FakeMap {
    calls = 0;
    panBy() {
      this.calls += 1;
    }
  }
  const quiet = new FakeMap();
  const other = new FakeMap();
  model.disablePanAnimation(quiet);
  assert.equal(other.panBy, FakeMap.prototype.panBy, 'the other map and the class are untouched');
  other.panBy();
  quiet.panBy();
  assert.equal(other.calls, 1);
  assert.equal(quiet.calls, 1);
});

// ---------------------------------------------------------------------------------------------
// Leaflet license notice

const normalizeEol = (text: string) => text.replace(/\r\n/g, '\n');

test('the Leaflet license notice ships as a public file that matches the installed leaflet exactly', () => {
  const shipped = normalizeEol(readFileSync(`${root}public/leaflet-LICENSE.txt`, 'utf8'));
  const installed = normalizeEol(readFileSync(`${root}node_modules/leaflet/LICENSE`, 'utf8'));
  assert.equal(shipped, installed);
  // What the BSD license says must travel with the code, spelled as the author has it.
  assert.match(shipped, /Copyright \(c\) 2010-2023, Volodymyr Agafonkin/);
  assert.match(shipped, /Copyright \(c\) 2010-2011, CloudMade/);
  assert.match(shipped, /Redistributions in binary form must reproduce the above copyright notice/);
  assert.match(shipped, /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"/);

  // The notice belongs to the version that ships.
  const pinned = (JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { dependencies: Record<string, string> })
    .dependencies.leaflet;
  const version = (JSON.parse(readFileSync(`${root}node_modules/leaflet/package.json`, 'utf8')) as { version: string })
    .version;
  assert.equal(version, pinned);
});

test('Vite copies public/ into the build, so the notice reaches dist', () => {
  const config = readFileSync(`${root}vite.config.ts`, 'utf8');
  assert.doesNotMatch(config, /publicDir|copyPublicDir/, 'the default public/ copy is not switched off or moved');
  assert.equal(model.LEAFLET_LICENSE_FILE, 'leaflet-LICENSE.txt');
});

test('the map links its license notice and the docs name where it ships', () => {
  const markup = renderMap(MOCK_LISTINGS);
  const link = markup.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  assert.ok(link, 'the map section has a link');
  assert.equal(link[1], '/leaflet-LICENSE.txt');
  assert.equal(link[2], 'Leaflet license notice');
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.ok(readFileSync(`${root}docs/radar-map.md`, 'utf8').includes('public/leaflet-LICENSE.txt'));
});

// ---------------------------------------------------------------------------------------------
// Map helper text contrast

/** Tailwind v4 palette entries are oklch. This is their sRGB relative luminance, as WCAG defines it. */
function paletteLuminance(name: string): number {
  if (name === 'black') return 0;
  const theme = readFileSync(`${root}node_modules/tailwindcss/theme.css`, 'utf8');
  const entry = theme.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
  assert.ok(entry, `${name} is in the Tailwind palette`);
  const lightness = Number(entry[1]) / 100;
  const hue = (Number(entry[3]) * Math.PI) / 180;
  const a = Number(entry[2]) * Math.cos(hue);
  const b = Number(entry[2]) * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((value) => Math.min(1, Math.max(0, value)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

const contrastRatio = (foreground: string, background: string) => {
  const [lighter, darker] = [paletteLuminance(foreground), paletteLuminance(background)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

test('the contrast calculation reproduces the 4.35:1 a browser measured for the old zinc-500 notice on black', () => {
  const old = contrastRatio('zinc-500', 'black');
  assert.ok(old > 4.3 && old < 4.4, `zinc-500 on black is ${old.toFixed(2)}`);
  assert.ok(contrastRatio('zinc-400', 'black') >= 4.5);
});

test('every text color the map component uses reads at 4.5:1 or better, even on its lightest background', () => {
  // The map text sits on the black page or on zinc-950, and a hovered list row on zinc-900. Light
  // text has the least contrast against the lightest of them, so zinc-900 is the case to pass.
  const source = readFileSync(`${root}src/components/Map/RentMap.tsx`, 'utf8');
  const used = new Set([...source.matchAll(/\btext-([a-z]+-\d{2,3})\b/g)].map((m) => m[1]));
  assert.ok(used.has('zinc-400') && used.size >= 6, `found ${[...used].join(', ')}`);
  for (const color of used) {
    const ratio = contrastRatio(color, 'zinc-900');
    assert.ok(ratio >= 4.5, `text-${color} on zinc-900 is ${ratio.toFixed(2)}:1`);
  }
});

// ---------------------------------------------------------------------------------------------
// The closed Copilot button next to the map credit

test('the closed Copilot button keeps its full accessible name when its caption is hidden on narrow screens', () => {
  const markup = renderToStaticMarkup(createElement(copilotModule.NemotronCopilot, { currentCity: 'all' }));
  const buttons = [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/gs)];
  assert.equal(buttons.length, 1, 'only the launcher is rendered while the panel is closed');
  assert.equal(textOf(buttons[0][1]), 'NEMOTRON TENANT COPILOT', 'the name stays in the button for assistive technology');
  const caption = buttons[0][1].match(/<span class="([^"]*)">NEMOTRON TENANT COPILOT<\/span>/);
  assert.ok(caption, 'the caption is its own element');
  assert.deepEqual(caption[1].split(' ').sort(), ['sm:not-sr-only', 'sr-only'], 'hidden visually below sm, shown from sm up');
});

// ---------------------------------------------------------------------------------------------
// Repository wiring

test('every test file is named in the CI workflow, since CI lists its test files explicitly', () => {
  const workflow = readFileSync(`${root}.github/workflows/ci.yml`, 'utf8');
  const files = readdirSync(`${root}tests`).filter((name) => name.endsWith('.test.ts'));
  assert.ok(files.includes('map-visualization.test.ts'));
  for (const file of files) {
    assert.ok(workflow.includes(`tests/${file}`), `${file} is not run by .github/workflows/ci.yml`);
  }
});

test('the browser entry loads Leaflet\'s stylesheet, which the server-side checks cannot see', () => {
  const entry = readFileSync(`${root}src/main.tsx`, 'utf8');
  assert.match(entry, /^import 'leaflet\/dist\/leaflet\.css'/m);
});
