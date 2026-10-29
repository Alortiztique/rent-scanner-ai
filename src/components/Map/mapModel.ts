// Pure policy for the Radar Map: tile source, score tiers, position validation, the plotted/omitted
// split, city context markers, and the view to show. It imports types only, so it never touches
// Leaflet, window, or document and loads on the server and under the offline tests.
import type { City, Listing } from '../../types';
import { APPROXIMATE_POSITION_NOTICE } from '../../data/mapCoordinates';
import type { GeoPoint } from '../../data/mapCoordinates';

// OpenStreetMap's public tile server: no key and no account, best effort with no availability
// promise. Keep the exact URL, the visible attribution, and the browser's normal Referer and cache
// behavior. Do not add a proxy, a prefetch, or a cache-busting query. https://operations.osmfoundation.org/policies/tiles/
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OSM_ATTRIBUTION_HTML = `&copy; <a href="${OSM_COPYRIGHT_URL}" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>`;

// Zoom 0 is the whole world in one 256 px tile. A phone is about 320 px wide, and framing San Francisco
// to Tokyo there needs zoom 0, so a higher minimum would push those pins off the map.
export const MAP_MIN_ZOOM = 0;
export const MAP_MAX_ZOOM = 19;
/** A selected city is shown at this zoom, wide enough that every fixture in it stays on a phone screen. */
export const CITY_ZOOM = 10;
/** The closest zoom automatic framing uses. A single listing is still only a neighborhood-scale point. */
export const CLOSE_ZOOM_CAP = 13;
export const FIT_PADDING_PX = 48;
// Shown only if no city has a usable position, which the bundled data never does.
const FALLBACK_CENTER: GeoPoint = { lat: 20, lng: 0 };

export type ScoreTier = 'green' | 'amber' | 'neutral';

export const GREEN_MIN_SCORE = 90;
export const AMBER_MIN_SCORE = 75;

export const TIER_RANGE_TEXT: Readonly<Record<ScoreTier, string>> = {
  green: '90 or higher',
  amber: '75 to 89',
  neutral: 'below 75',
};

/** Deal scores are 0 to 100. Anything else, including NaN and a missing value, is unavailable. */
export function hasUsableScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

/** Green from 90, amber from 75 up to 90, neutral below 75 and for an unavailable score. */
export function scoreTier(score: unknown): ScoreTier {
  if (!hasUsableScore(score)) return 'neutral';
  if (score >= GREEN_MIN_SCORE) return 'green';
  if (score >= AMBER_MIN_SCORE) return 'amber';
  return 'neutral';
}

export function formatScore(score: unknown): string {
  return hasUsableScore(score) ? String(Number(score.toFixed(2))) : 'n/a';
}

/** Savings are shown on their own and never feed the tier. */
export function describeSavings(percentage: unknown): string {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return 'Savings unavailable';
  const rounded = Number(Math.abs(percentage).toFixed(2));
  return `${rounded}% ${percentage < 0 ? 'above' : 'below'} the demo reference rent`;
}

export function pinLabel(listing: Listing): string {
  const tier = scoreTier(listing.dealScore);
  const score = hasUsableScore(listing.dealScore)
    ? `Deal score ${formatScore(listing.dealScore)} of 100, ${tier} tier (${TIER_RANGE_TEXT[tier]})`
    : 'Deal score unavailable, neutral tier';
  return `${listing.title}. ${listing.neighborhood}, ${listing.cityName}. ${score}. ${describeSavings(listing.savingsPercentage)}. ${APPROXIMATE_POSITION_NOTICE}.`;
}

const isCoordinate = (value: unknown, limit: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= -limit && value <= limit;

/** Finite latitude in [-90, 90] and longitude in [-180, 180]. (0, 0) is a valid point. */
export function isValidGeoPoint(value: unknown): value is GeoPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return isCoordinate(lat, 90) && isCoordinate(lng, 180);
}

type PositionTable = Readonly<Record<string, unknown>>;

function lookupPoint(positions: PositionTable, id: string): GeoPoint | null {
  // Own keys only, so an id such as "constructor" never reads an inherited property.
  if (!Object.hasOwn(positions, id)) return null;
  const value = positions[id];
  return isValidGeoPoint(value) ? { lat: value.lat, lng: value.lng } : null;
}

export interface PlottedListing {
  listing: Listing;
  point: GeoPoint;
  tier: ScoreTier;
  label: string;
  /** Changes whenever anything a pin shows changes, so a pin is rebuilt only when it must be. */
  signature: string;
}

export interface MapListingSplit {
  plotted: PlottedListing[];
  /** Listings with no valid position. They keep their place in the Grid. */
  omitted: Listing[];
}

/** Splits the visible listings, keeping their order. Plotted plus omitted always equals the input. */
export function splitListingsByPosition(listings: readonly Listing[], positions: PositionTable): MapListingSplit {
  const plotted: PlottedListing[] = [];
  const omitted: Listing[] = [];
  for (const listing of listings) {
    const point = lookupPoint(positions, listing.id);
    if (!point) {
      omitted.push(listing);
      continue;
    }
    const tier = scoreTier(listing.dealScore);
    const label = pinLabel(listing);
    plotted.push({
      listing,
      point,
      tier,
      label,
      signature: `${listing.id}|${point.lat},${point.lng}|${tier}|${formatScore(listing.dealScore)}|${label}`,
    });
  }
  return { plotted, omitted };
}

export interface ContextMarker {
  cityId: string;
  cityName: string;
  rating: 'High' | 'Severe';
  point: GeoPoint;
  description: string;
}

/**
 * Illustrative city-wide context for the High and Severe ratings already in the city data. It follows
 * the selected city only: every such city for "all", the one selected city if it qualifies, and
 * nothing for Moderate or unknown ids. It does not depend on the listing filters, and it is a point
 * at the approximate city center, not a neighborhood boundary or a verified danger claim.
 */
export function cityContextMarkers(
  cities: readonly City[],
  selectedCityId: string,
  positions: PositionTable,
): ContextMarker[] {
  const markers: ContextMarker[] = [];
  for (const city of cities) {
    if (selectedCityId !== 'all' && city.id !== selectedCityId) continue;
    const rating = city.gentrificationRating;
    if (rating !== 'High' && rating !== 'Severe') continue;
    const point = lookupPoint(positions, city.id);
    if (!point) continue;
    markers.push({
      cityId: city.id,
      cityName: city.name,
      rating,
      point,
      description: `${city.name}: existing ${rating} gentrification rating, shown at the approximate city center`,
    });
  }
  return markers;
}

export type MapViewPlan =
  | { kind: 'center'; key: string; center: GeoPoint; zoom: number }
  | { kind: 'bounds'; key: string; points: GeoPoint[] };

function distinctPoints(points: readonly GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  return points.filter((p) => {
    const key = `${p.lat},${p.lng}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const pointsKey = (points: readonly GeoPoint[]) =>
  points
    .map((p) => `${p.lat},${p.lng}`)
    .sort()
    .join(';');

/**
 * What the map should show. A selected city with a known center always shows that center at city
 * zoom, even with no matching listings. Otherwise the visible listing positions are framed: one
 * position at a capped close zoom, several by bounds, and none by the city center points. The key
 * names the framing, so the same view is not applied twice.
 */
export function planMapView(
  selectedCityId: string,
  plotted: readonly PlottedListing[],
  cityPositions: PositionTable,
): MapViewPlan {
  if (selectedCityId !== 'all') {
    const center = lookupPoint(cityPositions, selectedCityId);
    if (center) return { kind: 'center', key: `city:${selectedCityId}`, center, zoom: CITY_ZOOM };
  }

  let points = distinctPoints(plotted.map((p) => p.point));
  if (points.length === 0) {
    points = distinctPoints(
      Object.keys(cityPositions)
        .map((id) => lookupPoint(cityPositions, id))
        .filter((p): p is GeoPoint => p !== null),
    );
    if (points.length === 0) return { kind: 'center', key: 'fallback', center: FALLBACK_CENTER, zoom: MAP_MIN_ZOOM };
  }
  if (points.length === 1) {
    return { kind: 'center', key: `point:${pointsKey(points)}`, center: points[0], zoom: CLOSE_ZOOM_CAP };
  }
  return { kind: 'bounds', key: `bounds:${pointsKey(points)}`, points };
}
