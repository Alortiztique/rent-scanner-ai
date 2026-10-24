import { CITIES } from '../data/cities';
import { runTavilyScoutSearch } from './tavilySearch';
import { toTavilyScoutResult, type TavilyScoutResult } from './scoutListings';

export type { TavilyScoutMode, TavilyScoutResult } from './scoutListings';

const TAVILY_API_KEY = import.meta.env.VITE_TAVILY_API_KEY || '';

/**
 * Searches localized forums and listing boards for the given city using Tavily Search and
 * returns accepted hits as unverified ScoutListing candidates (no price, score, or audit).
 * The browser key and direct provider request are unchanged until the server integration.
 * Eligible for the $3,000 Nebius x NVIDIA "Best Use of Tavily" Prize!
 */
export async function searchLiveSubletsWithTavily(
  city: string,
  customQuery?: string
): Promise<TavilyScoutResult> {
  const outcome = await runTavilyScoutSearch({
    city,
    customQuery,
    cities: CITIES,
    apiKey: TAVILY_API_KEY,
    fetchImpl: (url, init) => fetch(url, init),
  });

  if (outcome.kind === 'demo') {
    console.info('[Tavily API] No API key detected. Returning a labelled demo sample; no search was run.');
  } else if (outcome.kind === 'unavailable') {
    console.warn('[Tavily API] Search unavailable:', outcome.error, outcome.cause ?? '');
  }
  return toTavilyScoutResult(outcome);
}
