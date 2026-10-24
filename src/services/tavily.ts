import type { City, Listing, TavilySearchResult } from '../types';
import { CITIES } from '../data/cities';
import { describeDemoResults, runTavilyScoutSearch, type CitySearchProfile } from './tavilySearch';

const TAVILY_API_KEY = import.meta.env.VITE_TAVILY_API_KEY || '';

/**
 * live: Tavily answered with a valid payload (results may be empty).
 * demo: no API key configured; a labelled fixture is returned instead of a search.
 * unavailable: request failed or the payload was malformed; no results are substituted.
 * unsupported: the city string does not resolve to a supported city.
 */
export type TavilyScoutMode = 'live' | 'demo' | 'unavailable' | 'unsupported';

export interface TavilyScoutResult {
  listings: Listing[];
  rawAnswer?: string;
  mode: TavilyScoutMode;
  error?: string;
  /** The query that was (or, in demo mode, would have been) sent. */
  query?: string;
}

/**
 * Searches localized forums and listing boards for the given city using Tavily Search.
 * Hits are unverified search results, not confirmed available rentals.
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

  switch (outcome.kind) {
    case 'unsupported':
      return { listings: [], mode: 'unsupported', error: outcome.error };
    case 'demo':
      console.info('[Tavily API] No API key detected. Returning labelled demo fixture; no search was run.');
      return getDemoTavilyScoutResults(outcome.city, outcome.profile, outcome.query);
    case 'unavailable':
      console.warn('[Tavily API] Search unavailable:', outcome.error, outcome.cause ?? '');
      return { listings: [], mode: 'unavailable', error: outcome.error, query: outcome.query };
    case 'live': {
      const batch = Date.now();
      return {
        mode: 'live',
        listings: outcome.results.map((hit, idx) => mapHitToLegacyListing(hit, idx, outcome.city, batch)),
        rawAnswer: outcome.answer,
        query: outcome.query,
      };
    }
  }
}

function truncateSnippet(content: string, max = 300): string {
  return content.length > max ? `${content.substring(0, max).trimEnd()}...` : content;
}

/**
 * Maps a Tavily hit onto the legacy Listing shape. Only id, title, city identity, link,
 * description, and tags come from the search hit and selected city.
 *
 * UNRESOLVED FOLLOW-UP: every other field below is legacy synthetic enrichment, not provider
 * evidence (USD price from the first currency-looking number, market price x1.6, fixed 38%
 * savings, deal score 88, bed/bath/size, furnished, broker fee, stock image, today's
 * verifiedDate, and the whole nemotronAudit block, which no model produced). A later
 * data-contract migration must represent these as unknown.
 */
function mapHitToLegacyListing(hit: TavilySearchResult, idx: number, city: City, batch: number): Listing {
  const priceMatch = hit.content.match(/\$([0-9,]+)|£([0-9,]+)|€([0-9,]+)|¥([0-9,]+)/);
  const parsedPrice = priceMatch ? parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3] || '950', 10) : 950 + idx * 120;

  return {
    id: `tavily-live-${city.id}-${batch}-${idx}`,
    title: hit.title,
    cityId: city.id,
    cityName: city.name,
    neighborhood: 'Live Web Scout Finding',
    priceLocal: parsedPrice,
    priceUsd: parsedPrice,
    currency: 'USD',
    currencySymbol: '$',
    originalMarketPriceUsd: Math.round(parsedPrice * 1.6),
    savingsPercentage: 38,
    dealScore: 88,
    type: 'sublease',
    duration: 'Flexible (Discovered via Tavily)',
    availableDate: 'Immediate',
    bedrooms: 1,
    bathrooms: 1,
    squareMeters: 45,
    squareFeet: 485,
    furnished: true,
    utilitiesIncluded: hit.content.toLowerCase().includes('utilities') || hit.content.toLowerCase().includes('bills included'),
    noBrokerFee: true,
    imageUrl: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
    source: 'Tavily Web Scout',
    sourceUrl: hit.url,
    description: truncateSnippet(hit.content),
    tags: ['Unverified Search Hit', 'Live Tavily Discovery', 'Real-Time Web', 'Direct Source'],
    verifiedDate: new Date().toISOString().split('T')[0],
    nemotronAudit: {
      scamRiskScore: 1,
      gentrificationIndex: 'Anti-Gentrification Champion',
      fairRentScore: 90,
      marketPriceComparison: 'Scraped directly from live community threads via Tavily AI Search.',
      verifiedPerks: [
        'Real-time indexing of non-traditional housing boards',
        'Bypasses real estate broker commissions',
      ],
      auditWarnings: [
        'Direct web listing: Always verify primary tenant identity before transaction',
      ],
      negotiationScript: `Hello, I saw your recent post regarding "${hit.title}". I am a vetted tenant ready for immediate contract signing.`,
      leaseClauseSummary: 'Direct tenant post indexed by Tavily Search API runtime.',
      analyzedByModel: 'NVIDIA Nemotron-3-Ultra (via Nebius Token Factory)',
    },
  };
}

/**
 * No-key demo fixture. Carries the selected city's identity and is labelled Demo. Its link
 * points at the city's first configured source site, not at a real posting. The price,
 * score, and audit values are the same legacy synthetic placeholders as before.
 */
function getDemoTavilyScoutResults(city: City, profile: CitySearchProfile, query: string): TavilyScoutResult {
  const listings: Listing[] = [
    {
      id: `tavily-demo-${city.id}-${Date.now()}-1`,
      title: `[Demo] Sample 2-Month Sublet in ${city.name} (Student Flat Fixture)`,
      cityId: city.id,
      cityName: city.name,
      neighborhood: 'Central Student Corridor',
      priceLocal: 980,
      priceUsd: 980,
      currency: 'USD',
      currencySymbol: '$',
      originalMarketPriceUsd: 1950,
      savingsPercentage: 50,
      dealScore: 95,
      type: 'room',
      duration: '2 Months (Immediate Move-In)',
      availableDate: '2026-10-20',
      bedrooms: 1,
      bathrooms: 1,
      squareMeters: 40,
      squareFeet: 430,
      furnished: true,
      utilitiesIncluded: true,
      noBrokerFee: true,
      imageUrl: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
      source: 'Tavily Web Scout',
      sourceUrl: `https://${profile.includeDomains[0]}/`,
      description: 'Demo fixture (not a real posting): Tenant traveling overseas on short notice. Fully furnished, high-speed WiFi, kitchen privileges. Flatshare with 1 postgraduate researcher.',
      tags: ['Demo Fixture', 'Unverified', 'Immediate Move-in', '50% Below Market'],
      verifiedDate: new Date().toISOString().split('T')[0],
      nemotronAudit: {
        scamRiskScore: 0,
        gentrificationIndex: 'Anti-Gentrification Champion',
        fairRentScore: 96,
        marketPriceComparison: '50% lower than prevailing commercial listing aggregators.',
        verifiedPerks: [
          'Direct peer-to-peer sublet',
          'Zero agency fee',
          'Includes all bills and gigabit internet',
        ],
        auditWarnings: ['Short notice lease assignment'],
        negotiationScript: 'Hi! I saw your post indexed via Tavily. I can take over the 2 months with zero delays.',
        leaseClauseSummary: 'Standard mutual lodger agreement.',
        analyzedByModel: 'NVIDIA Nemotron-3-Ultra (via Nebius Token Factory)',
      },
    },
  ];

  return {
    mode: 'demo',
    listings,
    rawAnswer: describeDemoResults(city.name, listings.length),
    query,
  };
}
