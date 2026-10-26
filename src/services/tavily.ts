import { CITIES } from '../data/cities';
import { readScoutMode, runScoutClientSearch } from './scoutClient';
import type { TavilyScoutResult } from './scoutListings';

export type { TavilyScoutMode, TavilyScoutResult } from './scoutListings';

/** Public build setting: "demo" (default) or "server". Holds no secret. */
const SCOUT_MODE_RAW: unknown = import.meta.env.VITE_SCOUT_MODE;

/** The Scout mode this build uses, for labels. Invalid settings make every search unavailable. */
export const scoutModeSetting = readScoutMode(SCOUT_MODE_RAW);

/**
 * Searches localized forums and listing boards for the given city and returns accepted hits
 * as unverified ScoutListing candidates (no price, score, or audit). In server mode the only
 * request goes to this site's /api/scout; the Tavily key stays on the private Scout Worker.
 * Local demo mode makes no network request.
 * Eligible for the $3,000 Nebius x NVIDIA "Best Use of Tavily" Prize!
 */
export async function searchLiveSubletsWithTavily(
  city: string,
  customQuery?: string,
  options: { signal?: AbortSignal } = {}
): Promise<TavilyScoutResult> {
  const { result, event, status } = await runScoutClientSearch({
    city,
    customQuery,
    mode: SCOUT_MODE_RAW,
    cities: CITIES,
    fetchImpl: (url, init) => fetch(url, init),
    signal: options.signal,
  });

  // Fixed event codes and the HTTP status only: no query, response text, or error detail.
  if (result.mode === 'unavailable') {
    console.warn(`[Scout] search unavailable: ${event}${status === undefined ? '' : ` (HTTP ${status})`}`);
  } else if (result.mode === 'demo') {
    console.info(`[Scout] ${event === 'server_demo' ? 'server answered demo mode' : 'local demo mode'}; no live search ran.`);
  }
  return result;
}
