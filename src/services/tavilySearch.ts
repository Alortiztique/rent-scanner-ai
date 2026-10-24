/**
 * Pure Tavily Scout search logic: city resolution, localized query/domain selection,
 * request construction, and response validation.
 *
 * This module intentionally has no runtime imports and no `import.meta.env` access so it
 * can run under `node --experimental-strip-types` in offline tests. City identities are
 * injected by callers (the app passes the existing CITIES records); local search
 * configuration lives here, keyed by city id, rather than in city economic metadata.
 */
import type { City, TavilySearchResult } from '../types';

export type CityIdentity = Pick<City, 'id' | 'name'>;

export interface CitySearchProfile {
  /** Extra inputs (besides the CITIES id and name) that identify this city. */
  aliases: readonly string[];
  /** Localized default query used when the custom query is blank. */
  defaultQuery: string;
  /** Source domains sent as Tavily include_domains for this city only. */
  includeDomains: readonly string[];
}

/** Up to five actual hits; sparse results are returned as-is, never padded. */
export const SCOUT_MAX_RESULTS = 5;

export const CITY_SEARCH_PROFILES: Readonly<Record<string, CitySearchProfile>> = {
  nyc: {
    aliases: ['New York', 'NY', 'Brooklyn', 'Manhattan', 'Queens', 'Bronx'],
    defaultQuery:
      'New York City sublet OR "lease takeover" OR "room for rent" "no broker fee" r/NYCapartments',
    includeDomains: ['reddit.com', 'craigslist.org', 'listingsproject.com', 'spareroom.com'],
  },
  london: {
    aliases: [],
    defaultQuery: 'London room to rent OR sublet OR lodger "bills included" "no agency fees"',
    includeDomains: ['spareroom.co.uk', 'gumtree.com', 'openrent.co.uk', 'reddit.com'],
  },
  tokyo: {
    aliases: ['東京'],
    defaultQuery:
      '東京 シェアハウス OR ルームシェア OR マンスリーマンション 礼金なし 敷金なし Tokyo share house no key money',
    includeDomains: ['hituji.jp', 'jimoty.jp', 'gaijinpot.com', 'reddit.com'],
  },
  bogota: {
    aliases: ['Bogota D.C.', 'Bogota DC'],
    defaultQuery:
      'Bogotá arriendo habitación OR apartaestudio "sin fiador" OR "directo con el dueño" OR "sin comisión"',
    includeDomains: ['fincaraiz.com.co', 'metrocuadrado.com', 'compartoapto.com', 'reddit.com'],
  },
  dubai: {
    aliases: ['دبي'],
    defaultQuery: 'Dubai room for rent OR "bed space" OR sublet monthly "no commission" "direct from owner"',
    includeDomains: ['dubizzle.com', 'bayut.com', 'propertyfinder.ae', 'reddit.com'],
  },
  paris: {
    aliases: [],
    defaultQuery:
      'Paris sous-location OR colocation OR "chambre à louer" "sans frais d\'agence" OR "particulier à particulier"',
    includeDomains: ['leboncoin.fr', 'pap.fr', 'lacartedescolocs.fr', 'reddit.com'],
  },
  berlin: {
    aliases: [],
    defaultQuery: 'Berlin Zwischenmiete OR Untermiete OR "WG-Zimmer" möbliert provisionsfrei',
    includeDomains: ['wg-gesucht.de', 'kleinanzeigen.de', 'reddit.com'],
  },
  sf: {
    aliases: ['San Fran'],
    defaultQuery: 'San Francisco sublet OR "room for rent" OR "lease takeover" "no broker fee"',
    includeDomains: ['reddit.com', 'craigslist.org', 'spareroom.com'],
  },
};

/** Labels the app uses for "no single city" views. They are never treated as a city. */
const AGGREGATE_CITY_LABELS: readonly string[] = ['global metropolises', 'global', 'all', 'all cities'];

export function normalizeCityText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCitySearchProfile(cityId: string): CitySearchProfile | undefined {
  return Object.hasOwn(CITY_SEARCH_PROFILES, cityId) ? CITY_SEARCH_PROFILES[cityId] : undefined;
}

/** Cities from the injected records that have a search profile, in record order. */
export function listSupportedCities<C extends CityIdentity>(cities: readonly C[]): C[] {
  return cities.filter((city) => getCitySearchProfile(city.id) !== undefined);
}

export type CityResolution<C extends CityIdentity> =
  | { status: 'supported'; city: C; profile: CitySearchProfile }
  | { status: 'unsupported'; input: string; reason: 'empty' | 'aggregate' | 'unknown' };

/**
 * Resolves a free-text city string to one of the injected city records by exact,
 * case- and accent-insensitive match on id, name, or a profile alias. No substring guessing.
 */
export function resolveSearchCity<C extends CityIdentity>(
  input: string,
  cities: readonly C[]
): CityResolution<C> {
  const raw = typeof input === 'string' ? input : '';
  const normalized = normalizeCityText(raw);
  if (!normalized) return { status: 'unsupported', input: raw, reason: 'empty' };
  if (AGGREGATE_CITY_LABELS.includes(normalized)) {
    return { status: 'unsupported', input: raw, reason: 'aggregate' };
  }

  for (const city of cities) {
    const profile = getCitySearchProfile(city.id);
    if (!profile) continue;
    const candidates = [city.id, city.name, ...profile.aliases];
    if (candidates.some((candidate) => normalizeCityText(candidate) === normalized)) {
      return { status: 'supported', city, profile };
    }
  }
  return { status: 'unsupported', input: raw, reason: 'unknown' };
}

/**
 * Chooses the Scout's initial city from the parent's label. Aggregate or unknown labels
 * (for example "Global Metropolises") fall back to the first supported city.
 */
export function pickScoutCity<C extends CityIdentity>(
  preferred: string,
  cities: readonly C[]
): { city: C; isFallback: boolean } | null {
  const resolution = resolveSearchCity(preferred, cities);
  if (resolution.status === 'supported') return { city: resolution.city, isFallback: false };
  const first = listSupportedCities(cities)[0];
  return first ? { city: first, isFallback: true } : null;
}

export function describeUnsupportedCity(
  resolution: Extract<CityResolution<CityIdentity>, { status: 'unsupported' }>,
  cities: readonly CityIdentity[]
): string {
  const choices = listSupportedCities(cities)
    .map((city) => city.name)
    .join(', ');
  const label = resolution.input.trim();
  if (resolution.reason === 'empty') return `No city was provided. Choose one of: ${choices}.`;
  if (resolution.reason === 'aggregate') {
    return `"${label}" is an aggregate view, not a city. Choose one of: ${choices}.`;
  }
  return `"${label}" is not a supported Scout city. Choose one of: ${choices}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsTerm(normalizedText: string, term: string): boolean {
  const normalizedTerm = normalizeCityText(term);
  if (!normalizedTerm) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}(?=$|[^a-z0-9])`).test(normalizedText);
}

/**
 * Trims a custom query and falls back to the localized default when blank. A custom query
 * that does not already name the city is prefixed with the city name to stay scoped to it.
 */
export function buildScoutQuery(
  city: CityIdentity,
  profile: CitySearchProfile,
  customQuery?: string
): string {
  const trimmed = typeof customQuery === 'string' ? customQuery.trim() : '';
  if (!trimmed) return profile.defaultQuery;
  const normalized = normalizeCityText(trimmed);
  const terms = [city.id, city.name, ...profile.aliases];
  return terms.some((term) => mentionsTerm(normalized, term)) ? trimmed : `${city.name} ${trimmed}`;
}

export interface TavilySearchRequestBody {
  query: string;
  search_depth: 'advanced';
  include_answer: boolean;
  max_results: number;
  include_domains: string[];
}

/** Request body without credentials; the browser service adds its key separately. */
export function buildTavilySearchRequest(
  city: CityIdentity,
  profile: CitySearchProfile,
  customQuery?: string
): TavilySearchRequestBody {
  return {
    query: buildScoutQuery(city, profile, customQuery),
    search_depth: 'advanced',
    include_answer: true,
    max_results: SCOUT_MAX_RESULTS,
    include_domains: [...profile.includeDomains],
  };
}

export function isTavilyKeyConfigured(key: string | undefined | null): boolean {
  const value = typeof key === 'string' ? key.trim() : '';
  return value.length > 0 && !value.includes('your_tavily_api_key');
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function formatSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export type ParsedTavilyResponse =
  | { ok: true; answer?: string; results: TavilySearchResult[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accepts a provider hit only when its required fields have the right types: an http(s) url,
 * a non-blank string title, and a string content snippet (which may be empty). Malformed hits
 * are discarded rather than given a substitute title or snippet.
 */
function normalizeHit(raw: unknown): TavilySearchResult | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.url !== 'string' || typeof raw.title !== 'string' || typeof raw.content !== 'string') {
    return null;
  }
  const url = raw.url.trim();
  const title = raw.title.trim();
  if (!isHttpUrl(url) || !title) return null;
  const hit: TavilySearchResult = { title, url, content: raw.content.trim() };
  if (typeof raw.score === 'number' && Number.isFinite(raw.score)) hit.score = raw.score;
  if (typeof raw.published_date === 'string' && raw.published_date.trim()) {
    hit.published_date = raw.published_date.trim();
  }
  return hit;
}

/**
 * Validates a Tavily /search payload. Keeps well-formed hits, de-duplicated by URL, capped at
 * maxResults. An empty results list is a successful empty search; a missing list or a
 * non-empty list without any well-formed hit is malformed.
 */
export function parseTavilySearchResponse(
  payload: unknown,
  maxResults: number = SCOUT_MAX_RESULTS
): ParsedTavilyResponse {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return { ok: false, error: 'Malformed Tavily response: the results list is missing.' };
  }

  const seen = new Set<string>();
  const results: TavilySearchResult[] = [];
  for (const raw of payload.results) {
    if (results.length >= maxResults) break;
    const hit = normalizeHit(raw);
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    results.push(hit);
  }

  if (payload.results.length > 0 && results.length === 0) {
    return {
      ok: false,
      error: 'Malformed Tavily response: no result had a valid http(s) link, title, and content.',
    };
  }

  const answer = typeof payload.answer === 'string' && payload.answer.trim() ? payload.answer.trim() : undefined;
  return { ok: true, answer, results };
}

export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';

/** Minimal fetch contract so offline tests can inject a fake without DOM types. */
export type ScoutFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ScoutSearchOutcome<C extends CityIdentity> =
  | { kind: 'unsupported'; error: string }
  | { kind: 'demo'; city: C; profile: CitySearchProfile; query: string }
  | { kind: 'unavailable'; city: C; query: string; error: string; cause?: unknown }
  | { kind: 'live'; city: C; query: string; answer?: string; results: TavilySearchResult[] };

/**
 * Resolves the city, builds the localized request, and classifies the provider outcome.
 * Without a configured key no request is made (demo). Network errors, HTTP errors, and
 * malformed payloads are 'unavailable'; nothing is substituted for them.
 */
export async function runTavilyScoutSearch<C extends CityIdentity>(options: {
  city: string;
  customQuery?: string;
  cities: readonly C[];
  apiKey: string | undefined;
  fetchImpl: ScoutFetch;
}): Promise<ScoutSearchOutcome<C>> {
  const resolution = resolveSearchCity(options.city, options.cities);
  if (resolution.status === 'unsupported') {
    return { kind: 'unsupported', error: describeUnsupportedCity(resolution, options.cities) };
  }

  const { city, profile } = resolution;
  const request = buildTavilySearchRequest(city, profile, options.customQuery);
  if (!isTavilyKeyConfigured(options.apiKey)) {
    return { kind: 'demo', city, profile, query: request.query };
  }

  const unavailable = (error: string, cause?: unknown): ScoutSearchOutcome<C> => ({
    kind: 'unavailable',
    city,
    query: request.query,
    error,
    cause,
  });

  let response: Awaited<ReturnType<ScoutFetch>>;
  try {
    response = await options.fetchImpl(TAVILY_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: options.apiKey, ...request }),
    });
  } catch (cause) {
    return unavailable('Tavily search could not be reached (network error).', cause);
  }

  if (!response.ok) return unavailable(`Tavily search failed with HTTP ${response.status}.`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    return unavailable('Malformed Tavily response: the body was not valid JSON.', cause);
  }

  const parsed = parseTavilySearchResponse(payload);
  if (!parsed.ok) return unavailable(parsed.error);
  return { kind: 'live', city, query: request.query, answer: parsed.answer, results: parsed.results };
}

export function describeDemoResults(cityName: string, count: number): string {
  const noun = count === 1 ? 'sample result' : 'sample results';
  return `Demo mode: ${count} ${noun} for ${cityName}. A local demo sample was used and no live search ran; it is synthetic text, not a real posting.`;
}
