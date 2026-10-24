/**
 * Pure Scout candidate logic: maps a classified Tavily outcome to unverified ScoutListing
 * candidates, merges imports, and selects which candidates the Radar shows.
 *
 * Candidates carry only facts from the selected city and the accepted hit. Nothing here reads
 * prices, dates, or other numbers out of snippets, and provider relevance is never a score.
 * Runtime imports use explicit .ts paths so `node --experimental-strip-types` can load this.
 */
import type { RadarListing, ScoutListing, TavilySearchResult } from '../types';
import { describeDemoResults, formatSourceHost, isHttpUrl } from './tavilySearch.ts';
import type { CityIdentity, ScoutSearchOutcome } from './tavilySearch.ts';

export const SCOUT_SOURCE: ScoutListing['source'] = 'Tavily Web Scout';
export const LIVE_CANDIDATE_TAG = 'Unverified search hit';
export const DEMO_CANDIDATE_TAG = 'Demo sample';
/** Radar city id meaning "no single city selected". */
export const ALL_CITIES_ID = 'all';

/**
 * live: a live search answered with a valid payload (results may be empty).
 * demo: no live search ran; one labelled local sample is created instead.
 * unavailable: the request failed or the answer was malformed; nothing is substituted.
 * unsupported: the city string does not resolve to a supported city.
 * cancelled: the caller cancelled the search before it finished.
 */
export type TavilyScoutMode = 'live' | 'demo' | 'unavailable' | 'unsupported' | 'cancelled';

export interface TavilyScoutResult {
  listings: ScoutListing[];
  rawAnswer?: string;
  mode: TavilyScoutMode;
  error?: string;
  /** The effective query that was searched, or would have been in demo mode. */
  query?: string;
  /** Why demo mode was used: the local demo setting, or the server's explicit demo answer. */
  demoSource?: 'local' | 'server';
}

export function isScoutListing(item: RadarListing): item is ScoutListing {
  return 'kind' in item && item.kind === 'scout';
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return url && isHttpUrl(url) ? url : null;
}

export function scoutCandidateId(mode: ScoutListing['mode'], cityId: string, sourceUrl: string): string {
  return `scout:${mode}:${cityId}:${sourceUrl}`;
}

/**
 * Builds a live candidate from one accepted hit. Title, link, and snippet are kept as the
 * provider sent them (outer whitespace trimmed); the city comes from the selected record.
 * Returns null for a hit without an http(s) link, a non-blank title, or a string snippet.
 */
export function createLiveScoutListing(hit: TavilySearchResult, city: CityIdentity): ScoutListing | null {
  const sourceUrl = safeSourceUrl(hit?.url);
  if (!sourceUrl || typeof hit.title !== 'string' || typeof hit.content !== 'string') return null;
  const title = hit.title.trim();
  if (!title) return null;
  return {
    kind: 'scout',
    mode: 'live',
    id: scoutCandidateId('live', city.id, sourceUrl),
    title,
    cityId: city.id,
    cityName: city.name,
    source: SCOUT_SOURCE,
    sourceUrl,
    description: hit.content.trim(),
    tags: [LIVE_CANDIDATE_TAG, formatSourceHost(sourceUrl)],
  };
}

/**
 * The explicitly labelled local sample shown when no search backend is configured. Its text
 * is synthetic and its link opens the city's first source site, not a posting.
 */
export function createDemoScoutListing(city: CityIdentity, sourceDomain: string): ScoutListing | null {
  const sourceUrl = safeSourceUrl(`https://${sourceDomain}/`);
  if (!sourceUrl) return null;
  const host = formatSourceHost(sourceUrl);
  return {
    kind: 'scout',
    mode: 'demo',
    id: scoutCandidateId('demo', city.id, sourceUrl),
    title: `[Demo] Sample search hit for ${city.name}`,
    cityId: city.id,
    cityName: city.name,
    source: SCOUT_SOURCE,
    sourceUrl,
    description: `Synthetic sample text, not a real posting. A live search would show a source title and snippet here, for example from ${host}. The link opens the ${host} homepage, not a listing.`,
    tags: [DEMO_CANDIDATE_TAG, host],
  };
}

function dedupeById(candidates: readonly ScoutListing[]): ScoutListing[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

/** Maps accepted hits in provider order, dropping unusable ones and repeated links. */
export function mapLiveScoutHits(hits: readonly TavilySearchResult[], city: CityIdentity): ScoutListing[] {
  const mapped: ScoutListing[] = [];
  for (const hit of hits) {
    const candidate = createLiveScoutListing(hit, city);
    if (candidate) mapped.push(candidate);
  }
  return dedupeById(mapped);
}

/** Converts the classified search outcome into the Scout result the modal displays. */
export function toTavilyScoutResult<C extends CityIdentity>(outcome: ScoutSearchOutcome<C>): TavilyScoutResult {
  switch (outcome.kind) {
    case 'unsupported':
      return { listings: [], mode: 'unsupported', error: outcome.error };
    case 'unavailable':
      return { listings: [], mode: 'unavailable', error: outcome.error, query: outcome.query };
    case 'demo': {
      const sample = createDemoScoutListing(outcome.city, outcome.profile.includeDomains[0] ?? '');
      const listings = sample ? [sample] : [];
      return {
        listings,
        mode: 'demo',
        rawAnswer: describeDemoResults(outcome.city.name, listings.length),
        query: outcome.query,
      };
    }
    case 'live':
      return {
        listings: mapLiveScoutHits(outcome.results, outcome.city),
        mode: 'live',
        rawAnswer: outcome.answer,
        query: outcome.query,
      };
  }
}

/** Adds imported candidates; re-importing the same link for the same city and mode replaces it. */
export function mergeScoutCandidates(
  existing: readonly ScoutListing[],
  incoming: readonly ScoutListing[]
): ScoutListing[] {
  const fresh = dedupeById(incoming);
  const freshIds = new Set(fresh.map((candidate) => candidate.id));
  return [...existing.filter((candidate) => !freshIds.has(candidate.id)), ...fresh];
}

export interface ScoutVisibilityFilter {
  /** A city id, or ALL_CITIES_ID for every city. */
  cityId: string;
  /** Free text matched case-insensitively against title, snippet, and tags. */
  searchQuery: string;
}

export function matchesScoutFilter(candidate: ScoutListing, filter: ScoutVisibilityFilter): boolean {
  if (filter.cityId !== ALL_CITIES_ID && candidate.cityId !== filter.cityId) return false;
  const query = filter.searchQuery.trim().toLowerCase();
  if (!query) return true;
  return [candidate.title, candidate.description, ...candidate.tags].some((text) =>
    text.toLowerCase().includes(query)
  );
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orders by city, live before demo, then title and link. Uses only text fields. */
export function compareScoutCandidates(a: ScoutListing, b: ScoutListing): number {
  return (
    collator.compare(a.cityName, b.cityName) ||
    compareCodePoints(a.cityId, b.cityId) ||
    (a.mode === b.mode ? 0 : a.mode === 'live' ? -1 : 1) ||
    collator.compare(a.title, b.title) ||
    compareCodePoints(a.title, b.title) ||
    compareCodePoints(a.sourceUrl, b.sourceUrl) ||
    compareCodePoints(a.id, b.id)
  );
}

/** The candidates Radar shows for the current city and text filter, in a fixed order. */
export function selectVisibleScoutCandidates(
  candidates: readonly ScoutListing[],
  filter: ScoutVisibilityFilter
): ScoutListing[] {
  return candidates.filter((candidate) => matchesScoutFilter(candidate, filter)).sort(compareScoutCandidates);
}
