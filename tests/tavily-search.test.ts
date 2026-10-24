// Offline checks for Tavily Scout query/city logic.
// Run: node --experimental-strip-types --test tests/tavily-search.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CITY_SEARCH_PROFILES,
  SCOUT_MAX_RESULTS,
  TAVILY_SEARCH_ENDPOINT,
  buildScoutQuery,
  buildTavilySearchRequest,
  describeDemoResults,
  describeUnsupportedCity,
  formatSourceHost,
  getCitySearchProfile,
  isTavilyKeyConfigured,
  listSupportedCities,
  parseTavilySearchResponse,
  pickScoutCity,
  resolveSearchCity,
  runTavilyScoutSearch,
} from '../src/services/tavilySearch.ts';
import type { CityIdentity, ScoutFetch } from '../src/services/tavilySearch.ts';

// src/data/cities.ts uses a bundler-resolved import, so Node cannot load it directly.
// Read the actual CITIES records' id/name pairs from the source instead of copying them.
const citiesSource = readFileSync(new URL('../src/data/cities.ts', import.meta.url), 'utf8');
const CITY_RECORDS: CityIdentity[] = [...citiesSource.matchAll(/id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map(
  (match) => ({ id: match[1], name: match[2] })
);

function supported(input: string): CityIdentity {
  const resolution = resolveSearchCity(input, CITY_RECORDS);
  assert.equal(resolution.status, 'supported', `expected "${input}" to resolve`);
  if (resolution.status !== 'supported') throw new Error('unreachable');
  return resolution.city;
}

function requestFor(cityId: string, customQuery?: string) {
  const city = CITY_RECORDS.find((c) => c.id === cityId);
  const profile = getCitySearchProfile(cityId);
  assert.ok(city && profile, `missing city or profile for ${cityId}`);
  return buildTavilySearchRequest(city, profile, customQuery);
}

test('reuses the eight CITIES records and every one has a localized search profile', () => {
  assert.deepEqual(
    CITY_RECORDS.map((c) => c.id),
    ['nyc', 'london', 'tokyo', 'bogota', 'dubai', 'paris', 'berlin', 'sf']
  );
  assert.deepEqual(Object.keys(CITY_SEARCH_PROFILES).sort(), CITY_RECORDS.map((c) => c.id).sort());
  assert.equal(listSupportedCities(CITY_RECORDS).length, 8);

  for (const city of CITY_RECORDS) {
    const profile = getCitySearchProfile(city.id);
    assert.ok(profile, city.id);
    assert.ok(profile.defaultQuery.trim().length > 0, `${city.id} default query`);
    assert.ok(profile.includeDomains.length >= 2, `${city.id} domains`);
    // The default query names the city, so blank-query searches stay scoped to it.
    assert.equal(buildScoutQuery(city, profile, profile.defaultQuery), profile.defaultQuery, city.id);
  }
});

test('resolves ids, names, aliases, case and accents to the matching CITIES record', () => {
  assert.deepEqual(supported('nyc'), { id: 'nyc', name: 'New York City' });
  assert.deepEqual(supported('New York City'), { id: 'nyc', name: 'New York City' });
  assert.deepEqual(supported('  new   york '), { id: 'nyc', name: 'New York City' });
  assert.deepEqual(supported('LONDON'), { id: 'london', name: 'London' });
  assert.deepEqual(supported('Bogota'), { id: 'bogota', name: 'Bogotá' });
  assert.deepEqual(supported('東京'), { id: 'tokyo', name: 'Tokyo' });
  assert.deepEqual(supported('sf'), { id: 'sf', name: 'San Francisco' });
});

test('fixes the legacy London/New York/otherwise-Bogota mapping', () => {
  for (const city of CITY_RECORDS) assert.equal(supported(city.name).id, city.id, city.name);
  assert.equal(supported('Tokyo').id, 'tokyo');
  assert.equal(supported('Berlin').id, 'berlin');
  assert.equal(supported('San Francisco').id, 'sf');
});

test('explicitly rejects unsupported, empty, aggregate and substring-only input', () => {
  const cases: Array<[string, string]> = [
    ['Madrid', 'unknown'],
    ['Londonderry', 'unknown'],
    ['New Yorkshire', 'unknown'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['Global Metropolises', 'aggregate'],
    ['Global', 'aggregate'],
  ];
  for (const [input, reason] of cases) {
    const resolution = resolveSearchCity(input, CITY_RECORDS);
    assert.equal(resolution.status, 'unsupported', input);
    if (resolution.status === 'unsupported') assert.equal(resolution.reason, reason, input);
  }

  const aggregate = resolveSearchCity('Global Metropolises', CITY_RECORDS);
  assert.equal(aggregate.status, 'unsupported');
  if (aggregate.status === 'unsupported') {
    const message = describeUnsupportedCity(aggregate, CITY_RECORDS);
    assert.match(message, /not a city/);
    for (const city of CITY_RECORDS) assert.ok(message.includes(city.name), city.name);
  }
});

test('Scout picks a visible supported city for "Global Metropolises" and keeps real selections', () => {
  assert.deepEqual(pickScoutCity('Global Metropolises', CITY_RECORDS), {
    city: { id: 'nyc', name: 'New York City' },
    isFallback: true,
  });
  assert.deepEqual(pickScoutCity('Berlin', CITY_RECORDS), {
    city: { id: 'berlin', name: 'Berlin' },
    isFallback: false,
  });
  assert.deepEqual(pickScoutCity('Bogotá', CITY_RECORDS)?.city, { id: 'bogota', name: 'Bogotá' });
  assert.equal(pickScoutCity('Berlin', []), null);
});

test('blank custom queries use the localized default; custom queries are trimmed and city-scoped', () => {
  const berlin = getCitySearchProfile('berlin');
  assert.ok(berlin);
  assert.equal(requestFor('berlin').query, berlin.defaultQuery);
  assert.equal(requestFor('berlin', '').query, berlin.defaultQuery);
  assert.equal(requestFor('berlin', '   \t ').query, berlin.defaultQuery);

  assert.equal(requestFor('berlin', '  Zwischenmiete Neukölln  ').query, 'Berlin Zwischenmiete Neukölln');
  assert.equal(requestFor('berlin', ' berlin WG-Zimmer ').query, 'berlin WG-Zimmer');
  assert.equal(requestFor('nyc', 'Brooklyn sublet no fee').query, 'Brooklyn sublet no fee');
  assert.equal(requestFor('bogota', 'habitación Bogota Chapinero').query, 'habitación Bogota Chapinero');
  // "comparison" contains "paris" but does not name the city.
  assert.equal(requestFor('paris', 'comparison colocation').query, 'Paris comparison colocation');
});

test('localized default terms per city', () => {
  assert.match(requestFor('berlin').query, /Zwischenmiete/);
  assert.match(requestFor('tokyo').query, /東京/);
  assert.match(requestFor('bogota').query, /arriendo/);
  assert.match(requestFor('paris').query, /colocation/);
  assert.match(requestFor('london').query, /bills included/);
  assert.match(requestFor('dubai').query, /bed space/);
  assert.match(requestFor('nyc').query, /no broker fee/);
});

test('domain selection is per city: Berlin can query wg-gesucht.de; US cities use US boards', () => {
  const berlin = requestFor('berlin');
  assert.ok(berlin.include_domains.includes('wg-gesucht.de'));
  assert.ok(!berlin.include_domains.includes('craigslist.org'));

  const nyc = requestFor('nyc');
  assert.ok(nyc.include_domains.includes('craigslist.org'));
  assert.ok(nyc.include_domains.includes('reddit.com'));
  assert.ok(!nyc.include_domains.includes('wg-gesucht.de'));

  assert.ok(requestFor('sf').include_domains.includes('craigslist.org'));
  assert.ok(requestFor('london').include_domains.includes('spareroom.co.uk'));
  assert.ok(requestFor('paris').include_domains.includes('leboncoin.fr'));
  assert.ok(requestFor('bogota').include_domains.includes('fincaraiz.com.co'));
  assert.ok(requestFor('tokyo').include_domains.includes('jimoty.jp'));
  assert.ok(requestFor('dubai').include_domains.includes('dubizzle.com'));
});

test('request construction is deterministic, bounded, and credential-free', () => {
  for (const city of CITY_RECORDS) {
    const first = requestFor(city.id, '  room  ');
    assert.deepEqual(requestFor(city.id, '  room  '), first, city.id);
    assert.equal(first.max_results, SCOUT_MAX_RESULTS);
    assert.ok(!('api_key' in first), city.id);
  }

  const copy = requestFor('berlin');
  copy.include_domains.push('example.com');
  assert.ok(!requestFor('berlin').include_domains.includes('example.com'));
});

test('response parsing keeps usable hits, de-duplicates, caps, and never pads', () => {
  const hit = (n: number) => ({ title: ` Hit ${n} `, url: `https://www.wg-gesucht.de/${n}.html`, content: `snippet ${n}` });
  const parsed = parseTavilySearchResponse({
    answer: '  summary  ',
    results: [hit(1), hit(1), { title: 'bad', url: 'javascript:alert(1)', content: '' }, hit(2), hit(3), hit(4), hit(5), hit(6)],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.answer, 'summary');
    assert.deepEqual(
      parsed.results.map((r) => r.url),
      [1, 2, 3, 4, 5].map((n) => `https://www.wg-gesucht.de/${n}.html`)
    );
    assert.equal(parsed.results[0].title, 'Hit 1');
    assert.equal(parsed.results[0].content, 'snippet 1');
  }

  const sparse = parseTavilySearchResponse({ results: [{ url: 'https://kleinanzeigen.de/s-1', content: 'x' }] });
  assert.equal(sparse.ok, true);
  if (sparse.ok) {
    assert.equal(sparse.results.length, 1);
    assert.equal(sparse.results[0].title, 'kleinanzeigen.de');
    assert.equal(sparse.answer, undefined);
  }

  const empty = parseTavilySearchResponse({ query: 'q', results: [] });
  assert.deepEqual(empty, { ok: true, answer: undefined, results: [] });

  for (const malformed of [null, 'oops', [], {}, { results: 'nope' }, { results: [{ title: 'no url' }] }]) {
    assert.equal(parseTavilySearchResponse(malformed).ok, false, JSON.stringify(malformed));
  }
  assert.equal(formatSourceHost('https://www.spareroom.co.uk/flatshare/1'), 'spareroom.co.uk');
});

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

test('no-key and placeholder-key searches are demo mode and make no request', async () => {
  for (const apiKey of [undefined, '', '   ', 'your_tavily_api_key_here']) {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ results: [] }));
    const outcome = await runTavilyScoutSearch({ city: 'Berlin', cities: CITY_RECORDS, apiKey, fetchImpl });
    assert.equal(outcome.kind, 'demo', String(apiKey));
    if (outcome.kind === 'demo') {
      assert.deepEqual(outcome.city, { id: 'berlin', name: 'Berlin' });
      assert.equal(outcome.query, getCitySearchProfile('berlin')?.defaultQuery);
    }
    assert.equal(calls.length, 0);
  }
  assert.equal(isTavilyKeyConfigured('tvly-test-fixture'), true);

  assert.equal(
    describeDemoResults('Berlin', 1),
    'Demo mode: 1 sample result for Berlin. No live Tavily search ran because no API key is configured; this is fixture data, not a real posting.'
  );
  assert.match(describeDemoResults('Tokyo', 2), /^Demo mode: 2 sample results for Tokyo\./);
});

test('live success sends the selected city request and returns only actual hits', async () => {
  const { fetchImpl, calls } = fakeFetch(() =>
    jsonResponse({
      answer: 'generated',
      results: [{ title: 'WG-Zimmer Neukölln', url: 'https://www.wg-gesucht.de/1.html', content: 'Zwischenmiete' }],
    })
  );
  const outcome = await runTavilyScoutSearch({
    city: 'berlin',
    customQuery: '  Zwischenmiete  ',
    cities: CITY_RECORDS,
    apiKey: 'tvly-test-fixture',
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TAVILY_SEARCH_ENDPOINT);
  assert.equal(calls[0].body.query, 'Berlin Zwischenmiete');
  assert.deepEqual(calls[0].body.include_domains, ['wg-gesucht.de', 'kleinanzeigen.de', 'reddit.com']);
  assert.equal(calls[0].body.max_results, 5);

  assert.equal(outcome.kind, 'live');
  if (outcome.kind === 'live') {
    assert.deepEqual(outcome.city, { id: 'berlin', name: 'Berlin' });
    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0].url, 'https://www.wg-gesucht.de/1.html');
    assert.equal(outcome.answer, 'generated');
  }
});

test('empty success is distinct from failure; failures and malformed payloads are unavailable', async () => {
  const run = (respond: () => ReturnType<ScoutFetch>, city = 'San Francisco') =>
    runTavilyScoutSearch({ city, cities: CITY_RECORDS, apiKey: 'tvly-test-fixture', fetchImpl: fakeFetch(respond).fetchImpl });

  const empty = await run(() => jsonResponse({ results: [] }));
  assert.equal(empty.kind, 'live');
  if (empty.kind === 'live') assert.deepEqual(empty.results, []);

  const network = await run(() => Promise.reject(new Error('offline')));
  assert.equal(network.kind, 'unavailable');
  if (network.kind === 'unavailable') assert.match(network.error, /network/);

  const http = await run(() => jsonResponse({ detail: 'rate limited' }, 429));
  assert.equal(http.kind, 'unavailable');
  if (http.kind === 'unavailable') assert.match(http.error, /HTTP 429/);

  const notJson = await run(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad json')) })
  );
  assert.equal(notJson.kind, 'unavailable');
  if (notJson.kind === 'unavailable') assert.match(notJson.error, /not valid JSON/);

  const malformed = await run(() => jsonResponse({ unexpected: true }));
  assert.equal(malformed.kind, 'unavailable');
  if (malformed.kind === 'unavailable') {
    assert.match(malformed.error, /Malformed/);
    assert.deepEqual(malformed.city, { id: 'sf', name: 'San Francisco' });
  }
});

test('unsupported city strings never reach the provider', async () => {
  for (const city of ['Global Metropolises', 'Madrid', '']) {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ results: [] }));
    const outcome = await runTavilyScoutSearch({ city, cities: CITY_RECORDS, apiKey: 'tvly-test-fixture', fetchImpl });
    assert.equal(outcome.kind, 'unsupported', city);
    assert.equal(calls.length, 0, city);
  }
});

test('pure search module has no runtime imports or import.meta.env access', () => {
  const source = readFileSync(new URL('../src/services/tavilySearch.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bimport\.meta\b/.test(source));
  const importLines = source.split('\n').filter((line) => /^\s*import\s/.test(line));
  assert.ok(importLines.length > 0);
  for (const line of importLines) assert.match(line, /^import type /, line);
});
