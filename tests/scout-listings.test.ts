// Offline checks for truthful Scout candidates and the Radar candidate selection used by App.
// Run: node --experimental-strip-types --test tests/scout-listings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../src/data/cities.ts';
import {
  ALL_CITIES_ID,
  compareScoutCandidates,
  createDemoScoutListing,
  createLiveScoutListing,
  isScoutListing,
  mapLiveScoutHits,
  mergeScoutCandidates,
  selectVisibleScoutCandidates,
  toTavilyScoutResult,
} from '../src/services/scoutListings.ts';
import { getCitySearchProfile, runTavilyScoutSearch } from '../src/services/tavilySearch.ts';
import type { CityIdentity, ScoutFetch } from '../src/services/tavilySearch.ts';
import type { Listing, RadarListing, ScoutListing } from '../src/types/index.ts';

// The actual CITIES records, loaded natively (src/data/cities.ts has only a type import).
const CITY_RECORDS: CityIdentity[] = CITIES.map(({ id, name }) => ({ id, name }));
assert.equal(CITY_RECORDS.length, 8);

const SCOUT_LISTING_KEYS = [
  'cityId',
  'cityName',
  'description',
  'id',
  'kind',
  'mode',
  'source',
  'sourceUrl',
  'tags',
  'title',
];

const FABRICATED_FIELDS = [
  'priceLocal',
  'priceUsd',
  'currency',
  'currencySymbol',
  'originalMarketPriceUsd',
  'savingsPercentage',
  'dealScore',
  'score',
  'published_date',
  'type',
  'duration',
  'availableDate',
  'bedrooms',
  'bathrooms',
  'squareMeters',
  'squareFeet',
  'furnished',
  'utilitiesIncluded',
  'noBrokerFee',
  'imageUrl',
  'verifiedDate',
  'nemotronAudit',
  'neighborhood',
];

function city(id: string): CityIdentity {
  const record = CITY_RECORDS.find((c) => c.id === id);
  assert.ok(record, `missing CITIES record ${id}`);
  return record;
}

type FakeCall = { url: string; body: Record<string, unknown> };

function fakeFetch(respond: () => ReturnType<ScoutFetch>): { fetchImpl: ScoutFetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl: ScoutFetch = (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return respond();
  };
  return { fetchImpl, calls };
}

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) });

/** The same pipeline the browser service runs: fake transport -> classify -> candidate mapping. */
async function scout(cityInput: string, respond: () => ReturnType<ScoutFetch>, apiKey = 'tvly-test-fixture') {
  const { fetchImpl, calls } = fakeFetch(respond);
  const outcome = await runTavilyScoutSearch({ city: cityInput, cities: CITY_RECORDS, apiKey, fetchImpl });
  return { result: toTavilyScoutResult(outcome), calls };
}

function assertTruthfulCandidate(candidate: ScoutListing) {
  assert.deepEqual(Object.keys(candidate).sort(), SCOUT_LISTING_KEYS);
  for (const field of FABRICATED_FIELDS) assert.ok(!(field in candidate), `unexpected ${field}`);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'tags') {
      assert.ok(Array.isArray(value) && value.every((tag) => typeof tag === 'string'), 'tags are strings');
    } else {
      assert.equal(typeof value, 'string', `${key} is text, not a number or flag`);
    }
  }
  assert.ok(!JSON.stringify(candidate).includes(new Date().toISOString().slice(0, 10)), "today's date leaked");
}

const LIVE_FIXTURES = [
  {
    cityId: 'berlin',
    hit: {
      title: 'WG-Zimmer in Neukölln – Zwischenmiete | WG-Gesucht',
      url: 'https://www.wg-gesucht.de/wg-zimmer-in-Berlin-Neukoelln.10.html',
      content: 'Zwischenmiete ab 01.07.2026 für 3 Monate, 520 € warm, 14 m², Kaution 1.040 €.',
      score: 0.97,
      published_date: '2026-06-02',
    },
  },
  {
    cityId: 'tokyo',
    hit: {
      title: '高円寺 シェアハウス 個室',
      url: 'https://jimoty.jp/estate/article-123',
      content: '家賃 ¥65,000/月、敷金なし、礼金なし。2026年11月1日入居可。$430 相当。',
      score: 0.81,
    },
  },
  {
    cityId: 'bogota',
    hit: {
      title: 'Arriendo habitación Chapinero Alto - directo con el dueño',
      url: 'https://www.fincaraiz.com.co/inmueble/habitacion-en-arriendo/chapinero/bogota/7654321',
      content: 'Habitación amoblada $1.200.000 COP, servicios incluidos, disponible desde el 15 de julio. USD 300 aprox.',
      published_date: '2026-07-01',
    },
  },
];

test('accepted Berlin, Tokyo, and Bogotá hits become live candidates with only source and city facts', async () => {
  for (const { cityId, hit } of LIVE_FIXTURES) {
    const record = city(cityId);
    const { result, calls } = await scout(record.name, () =>
      jsonResponse({ answer: 'Provider summary, unverified.', results: [hit] })
    );

    assert.equal(calls.length, 1, cityId);
    assert.equal(result.mode, 'live', cityId);
    assert.equal(result.listings.length, 1, cityId);
    const [candidate] = result.listings;
    assert.deepEqual(candidate, {
      kind: 'scout',
      mode: 'live',
      id: `scout:live:${cityId}:${hit.url}`,
      title: hit.title,
      cityId: record.id,
      cityName: record.name,
      source: 'Tavily Web Scout',
      sourceUrl: hit.url,
      description: hit.content,
      tags: ['Unverified search hit', new URL(hit.url).hostname.replace(/^www\./, '')],
    });
    assertTruthfulCandidate(candidate);
    assert.equal(isScoutListing(candidate), true);
  }
});

test('provider whitespace is trimmed but source text is otherwise preserved verbatim', async () => {
  const { result } = await scout('Berlin', () =>
    jsonResponse({
      results: [
        {
          title: '  Möbliertes Zimmer, Wedding  ',
          url: ' https://www.kleinanzeigen.de/s-anzeige/zimmer/42 ',
          content: '\n  Untermiete\nab sofort: 480 € kalt + 60 € NK.  ',
        },
      ],
    })
  );
  assert.equal(result.mode, 'live');
  assert.deepEqual(
    result.listings.map((c) => [c.title, c.sourceUrl, c.description]),
    [['Möbliertes Zimmer, Wedding', 'https://www.kleinanzeigen.de/s-anzeige/zimmer/42', 'Untermiete\nab sofort: 480 € kalt + 60 € NK.']]
  );
});

test('no-key demo creates one labelled local sample per city and makes no request', async () => {
  for (const record of CITY_RECORDS) {
    const { result, calls } = await scout(record.name, () => jsonResponse({ results: [] }), '');
    assert.equal(calls.length, 0, record.id);
    assert.equal(result.mode, 'demo', record.id);
    assert.equal(result.listings.length, 1, record.id);
    assert.match(result.rawAnswer ?? '', new RegExp(`^Demo mode: 1 sample result for ${record.name}\\.`));
    assert.match(result.rawAnswer ?? '', /A local demo sample was used and no live search ran/);
    assert.doesNotMatch(result.rawAnswer ?? '', /API key|backend/i);

    const [sample] = result.listings;
    const domain = getCitySearchProfile(record.id)?.includeDomains[0];
    assert.ok(domain, record.id);
    assert.equal(sample.kind, 'scout');
    assert.equal(sample.mode, 'demo');
    assert.equal(sample.cityId, record.id);
    assert.equal(sample.cityName, record.name);
    assert.equal(sample.sourceUrl, `https://${domain}/`);
    assert.equal(sample.id, `scout:demo:${record.id}:https://${domain}/`);
    assert.match(sample.title, /^\[Demo\] /);
    assert.match(sample.description, /not a real posting/);
    assert.ok(sample.tags.includes('Demo sample'));
    assertTruthfulCandidate(sample);
  }
});

test('failures, malformed payloads, and unsupported cities produce no candidates and no demo fallback', async () => {
  const cases: Array<[string, () => ReturnType<ScoutFetch>, string]> = [
    ['network', () => Promise.reject(new Error('offline')), 'unavailable'],
    ['http 500', () => jsonResponse({ detail: 'x' }, 500), 'unavailable'],
    ['missing results', () => jsonResponse({ answer: 'only an answer' }), 'unavailable'],
    ['all malformed', () => jsonResponse({ results: [{ url: 'https://wg-gesucht.de/1', title: 17, content: {} }] }), 'unavailable'],
  ];
  for (const [label, respond, mode] of cases) {
    const { result } = await scout('Berlin', respond);
    assert.equal(result.mode, mode, label);
    assert.deepEqual(result.listings, [], label);
  }

  const unsupported = await scout('Global Metropolises', () => jsonResponse({ results: [] }));
  assert.equal(unsupported.result.mode, 'unsupported');
  assert.deepEqual(unsupported.result.listings, []);
  assert.equal(unsupported.calls.length, 0);

  const empty = await scout('Berlin', () => jsonResponse({ results: [] }));
  assert.equal(empty.result.mode, 'live');
  assert.deepEqual(empty.result.listings, []);
});

test('a mixed provider list keeps only the genuine hits as candidates', async () => {
  const { result } = await scout('Tokyo', () =>
    jsonResponse({
      results: [
        { url: 'https://jimoty.jp/1', title: 17, content: {} },
        { url: 'https://jimoty.jp/2', title: '中野 ルームシェア', content: '' },
        { url: 'https://jimoty.jp/3', content: 'missing title' },
        { url: 'https://hituji.jp/4', title: 'シェアハウス 高円寺', content: '個室 ¥58,000' },
      ],
    })
  );
  assert.equal(result.mode, 'live');
  assert.deepEqual(
    result.listings.map((c) => [c.title, c.sourceUrl, c.description]),
    [
      ['中野 ルームシェア', 'https://jimoty.jp/2', ''],
      ['シェアハウス 高円寺', 'https://hituji.jp/4', '個室 ¥58,000'],
    ]
  );
});

test('candidate mapping rejects unsafe or unusable links and repeated links', () => {
  const berlin = city('berlin');
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/relative/path', 'ftp://example.com/x', '']) {
    assert.equal(createLiveScoutListing({ title: 'x', url, content: 'y' }, berlin), null, url);
  }
  assert.equal(createLiveScoutListing({ title: '  ', url: 'https://wg-gesucht.de/1', content: 'y' }, berlin), null);
  const bad = { title: 'x', url: 'https://wg-gesucht.de/1', content: 5 } as unknown as Parameters<typeof createLiveScoutListing>[0];
  assert.equal(createLiveScoutListing(bad, berlin), null);

  const hit = { title: 'WG-Zimmer', url: 'https://www.wg-gesucht.de/1.html', content: 'Zwischenmiete' };
  assert.equal(mapLiveScoutHits([hit, { ...hit, title: 'copy' }], berlin).length, 1);
  assert.equal(createDemoScoutListing(berlin, ''), null);
});

test('imports merge by city, mode, and link without duplicating re-imported hits', () => {
  const hit = { title: 'WG-Zimmer', url: 'https://www.wg-gesucht.de/1.html', content: 'first snippet' };
  const first = mapLiveScoutHits([hit], city('berlin'));
  const again = mapLiveScoutHits([{ ...hit, content: 'refreshed snippet' }], city('berlin'));
  const merged = mergeScoutCandidates(first, again);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].description, 'refreshed snippet');

  const paris = mapLiveScoutHits([hit], city('paris'));
  const demo = createDemoScoutListing(city('berlin'), 'wg-gesucht.de');
  assert.ok(demo);
  const all = mergeScoutCandidates(mergeScoutCandidates(merged, paris), [demo]);
  assert.deepEqual(all.map((c) => [c.cityId, c.mode]), [
    ['berlin', 'live'],
    ['paris', 'live'],
    ['berlin', 'demo'],
  ]);
});

function sampleCandidates(): ScoutListing[] {
  const hit = (title: string, url: string, content: string) => ({ title, url, content });
  return [
    ...mapLiveScoutHits(
      [
        hit('Zimmer Wedding', 'https://www.kleinanzeigen.de/s-1', 'Untermiete ab sofort, 480 €'),
        hit('WG-Zimmer Neukölln', 'https://www.wg-gesucht.de/2.html', 'Zwischenmiete Juli'),
      ],
      city('berlin')
    ),
    ...mapLiveScoutHits([hit('Arriendo Chapinero', 'https://www.fincaraiz.com.co/3', 'Habitación amoblada')], city('bogota')),
    createDemoScoutListing(city('berlin'), 'wg-gesucht.de') as ScoutListing,
    createDemoScoutListing(city('tokyo'), 'hituji.jp') as ScoutListing,
  ];
}

test('Radar candidate visibility applies the selected city and trimmed, case-insensitive text', () => {
  const candidates = sampleCandidates();
  const ids = (filter: { cityId: string; searchQuery: string }) =>
    selectVisibleScoutCandidates(candidates, filter).map((c) => `${c.cityId}/${c.mode}/${c.title}`);

  assert.deepEqual(ids({ cityId: ALL_CITIES_ID, searchQuery: '' }), [
    'berlin/live/WG-Zimmer Neukölln',
    'berlin/live/Zimmer Wedding',
    'berlin/demo/[Demo] Sample search hit for Berlin',
    'bogota/live/Arriendo Chapinero',
    'tokyo/demo/[Demo] Sample search hit for Tokyo',
  ]);
  assert.deepEqual(ids({ cityId: 'berlin', searchQuery: '   ' }), [
    'berlin/live/WG-Zimmer Neukölln',
    'berlin/live/Zimmer Wedding',
    'berlin/demo/[Demo] Sample search hit for Berlin',
  ]);
  assert.deepEqual(ids({ cityId: 'berlin', searchQuery: '  ZWISCHENMIETE ' }), ['berlin/live/WG-Zimmer Neukölln']);
  assert.deepEqual(ids({ cityId: ALL_CITIES_ID, searchQuery: 'demo sample' }), [
    'berlin/demo/[Demo] Sample search hit for Berlin',
    'tokyo/demo/[Demo] Sample search hit for Tokyo',
  ]);
  assert.deepEqual(ids({ cityId: ALL_CITIES_ID, searchQuery: 'kleinanzeigen.de' }), ['berlin/live/Zimmer Wedding']);
  assert.deepEqual(ids({ cityId: 'paris', searchQuery: '' }), []);
  assert.deepEqual(ids({ cityId: 'berlin', searchQuery: 'nonexistent' }), []);
  // A currency-looking query matches snippet text only; it is not a price comparison.
  assert.deepEqual(ids({ cityId: ALL_CITIES_ID, searchQuery: '480 €' }), ['berlin/live/Zimmer Wedding']);
});

test('candidate order is deterministic and uses no numeric facts', () => {
  const candidates = sampleCandidates();
  const expected = selectVisibleScoutCandidates(candidates, { cityId: ALL_CITIES_ID, searchQuery: '' }).map((c) => c.id);

  const permutations = (items: ScoutListing[]): ScoutListing[][] =>
    items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
  for (const order of permutations(candidates)) {
    assert.deepEqual(selectVisibleScoutCandidates(order, { cityId: ALL_CITIES_ID, searchQuery: '' }).map((c) => c.id), expected);
  }

  for (const a of candidates) {
    for (const b of candidates) {
      const ab = compareScoutCandidates(a, b);
      assert.ok(Number.isFinite(ab), 'comparator result is finite');
      assert.equal(Math.sign(ab), -Math.sign(compareScoutCandidates(b, a)) || 0);
      if (a === b) assert.equal(ab, 0);
    }
  }
  assert.deepEqual(candidates.map((c) => c.id), sampleCandidates().map((c) => c.id), 'input not mutated');
});

test('complete legacy Listing fixtures stay compatible and are never treated as candidates', () => {
  const fixture: Listing = {
    id: 'nyc-sublet-01',
    title: 'Bushwick Artist Loft Sublet',
    cityId: 'nyc',
    cityName: 'New York City',
    neighborhood: 'Bushwick',
    priceLocal: 1250,
    priceUsd: 1250,
    currency: 'USD',
    currencySymbol: '$',
    originalMarketPriceUsd: 2800,
    savingsPercentage: 55,
    dealScore: 96,
    type: 'room',
    duration: '4 Months',
    availableDate: '2026-11-01',
    bedrooms: 1,
    bathrooms: 1,
    squareMeters: 65,
    squareFeet: 700,
    furnished: true,
    utilitiesIncluded: true,
    noBrokerFee: true,
    imageUrl: 'https://images.example/loft.jpg',
    source: 'Reddit Sublet',
    sourceUrl: 'https://reddit.com/r/NYCapartments/comments/x',
    description: 'Fixture description.',
    tags: ['Sublease'],
    verifiedDate: '2026-10-16',
    nemotronAudit: {
      scamRiskScore: 1,
      gentrificationIndex: 'Anti-Gentrification Champion',
      fairRentScore: 97,
      marketPriceComparison: '55% below median.',
      verifiedPerks: ['Direct tenant'],
      auditWarnings: ['Inspect first'],
      negotiationScript: 'Hello!',
      leaseClauseSummary: 'Standard.',
      analyzedByModel: 'fixture',
    },
  };
  const snapshot = structuredClone(fixture);
  const [candidate] = mapLiveScoutHits([{ title: 'Hit', url: 'https://reddit.com/r/x/1', content: '' }], city('nyc'));
  const radar: RadarListing[] = [fixture, candidate];

  assert.equal(isScoutListing(fixture), false);
  assert.deepEqual(radar.filter(isScoutListing).map((c) => c.id), [candidate.id]);
  assert.deepEqual(radar.filter((item) => !isScoutListing(item)).map((item) => item.id), ['nyc-sublet-01']);
  assert.deepEqual(fixture, snapshot, 'fixture values unchanged');
});
