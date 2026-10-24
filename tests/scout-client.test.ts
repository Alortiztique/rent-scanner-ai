// Offline checks for the browser Scout client (src/services/scoutClient.ts): local demo,
// the fixed same-origin /api/scout request, answer validation, deadlines and cancellation.
// Every server is a fake; the end-to-end case wires the real Pages adapter and Worker
// handlers behind a fake network with a fake provider. The global fetch throws outside that
// case, so no real network call can happen.
// Run: node --experimental-strip-types --test tests/scout-client.test.ts
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../src/data/cities.ts';
import { getCitySearchProfile } from '../src/services/tavilySearch.ts';
import { readScoutMode, runScoutClientSearch } from '../src/services/scoutClient.ts';
import type { ScoutClientFetch, ScoutClientOptions, ScoutClientRequestInit } from '../src/services/scoutClient.ts';
import scoutWorker from '../worker/scout.ts';
import type { ProviderRequestInit, RateLimiter, ScoutEnv } from '../worker/scout.ts';
import { onRequest } from '../functions/api/scout.ts';
import type { ScoutPagesEnv } from '../functions/api/scout.ts';

// Contract values, stated independently of the implementation.
const ENDPOINT_PATH = '/api/scout';
const SERVER_PROVIDER_TIMEOUT_MS = 10_000;
const CLIENT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CITY_IDS = ['nyc', 'london', 'tokyo', 'bogota', 'dubai', 'paris', 'berlin', 'sf'];

const ORIGIN = 'https://rentscanner.example';
const CLIENT_IP = '203.0.113.7'; // RFC 5737 documentation address
const FAKE_KEY = 'tvly-FAKE-offline-client-test-key-0002';
const SERVER_DETAIL = 'server-internal-detail-91be';
const BERLIN = { id: 'berlin', name: 'Berlin' };
const BERLIN_DEFAULT_QUERY = getCitySearchProfile('berlin')?.defaultQuery ?? '';
assert.ok(BERLIN_DEFAULT_QUERY);

const NO_NETWORK = (() => {
  throw new Error('real network access is disabled in scout-client tests');
}) as typeof fetch;
globalThis.fetch = NO_NETWORK;

const logLines: string[] = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[method] = (...args: unknown[]) => {
    logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
}

// ---------------------------------------------------------------------------------------------
// Fixture utilities

interface ServerCall {
  url: string;
  init: ScoutClientRequestInit;
  body: Record<string, unknown>;
}

function fakeServer(respond: (call: ServerCall) => Response | Promise<Response>) {
  const calls: ServerCall[] = [];
  const fetchImpl: ScoutClientFetch = (url, init) => {
    const call: ServerCall = { url, init, body: JSON.parse(init.body) as Record<string, unknown> };
    calls.push(call);
    return Promise.resolve().then(() => respond(call));
  };
  return { fetchImpl, calls };
}

const jsonReply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const liveReply = (city: { id: string; name: string }, query: string, results: unknown[], extra: Record<string, unknown> = {}) =>
  jsonReply(200, { mode: 'live', city, query, results, ...extra });

const hit = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `WG-Zimmer ${n}`,
  url: `https://www.wg-gesucht.de/${n}.html`,
  content: `Zwischenmiete ${n}, 520 € warm`,
  ...extra,
});

function search(options: Partial<ScoutClientOptions> & { fetchImpl: ScoutClientFetch }) {
  return runScoutClientSearch({ city: 'Berlin', mode: 'server', cities: CITIES, ...options });
}

/** Rejects with AbortError when the client aborts the request. */
const pendingUntilAborted = (call: ServerCall) =>
  new Promise<Response>((_, reject) => {
    call.init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

const flush = async (turns = 5) => {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

function assertNoCandidates(outcome: Awaited<ReturnType<typeof runScoutClientSearch>>, mode: string, label: string) {
  assert.equal(outcome.result.mode, mode, label);
  assert.deepEqual(outcome.result.listings, [], label);
  assert.equal(outcome.result.demoSource, undefined, label);
}

// ---------------------------------------------------------------------------------------------
// Mode setting and local demo

test('VITE_SCOUT_MODE: absent or blank is demo; only exact "demo" and "server" are accepted', () => {
  for (const raw of [undefined, null, '', '   ', 'demo', ' demo ']) {
    assert.deepEqual(readScoutMode(raw), { ok: true, mode: 'demo' }, String(raw));
  }
  for (const raw of ['server', ' server\n']) assert.deepEqual(readScoutMode(raw), { ok: true, mode: 'server' });
  for (const raw of ['live', 'Server', 'DEMO', 'demo,server', 'true', 1, true, {}]) {
    assert.deepEqual(readScoutMode(raw), { ok: false }, JSON.stringify(raw));
  }
});

test('an invalid configured mode is unavailable and makes no request', async () => {
  for (const mode of ['live', 'SERVER', 'prod']) {
    const server = fakeServer(() => jsonReply(200, {}));
    const outcome = await search({ mode, fetchImpl: server.fetchImpl });
    assertNoCandidates(outcome, 'unavailable', mode);
    assert.equal(outcome.event, 'invalid_mode');
    assert.match(outcome.result.error ?? '', /VITE_SCOUT_MODE must be "demo" or "server"/);
    assert.equal(server.calls.length, 0, mode);
  }
});

test('local demo makes zero requests and returns the labelled local sample for every city', async () => {
  for (const mode of [undefined, '', 'demo']) {
    for (const record of CITIES) {
      const server = fakeServer(() => jsonReply(200, {}));
      const outcome = await search({ mode, city: record.name, fetchImpl: server.fetchImpl });
      assert.equal(server.calls.length, 0, record.id);
      assert.equal(outcome.event, 'local_demo');
      assert.equal(outcome.result.mode, 'demo');
      assert.equal(outcome.result.demoSource, 'local');
      assert.equal(outcome.result.query, getCitySearchProfile(record.id)?.defaultQuery);
      assert.match(outcome.result.rawAnswer ?? '', /A local demo sample was used and no live search ran/);
      assert.equal(outcome.result.listings.length, 1);
      const [sample] = outcome.result.listings;
      assert.equal(sample.mode, 'demo');
      assert.equal(sample.cityId, record.id);
      assert.equal(sample.cityName, record.name);
      assert.match(sample.title, /^\[Demo\] /);
    }
  }
  const custom = await search({ mode: 'demo', customQuery: '  Wedding  ', fetchImpl: fakeServer(() => jsonReply(200, {})).fetchImpl });
  assert.equal(custom.result.query, 'Berlin Wedding');
});

// ---------------------------------------------------------------------------------------------
// Server mode: request construction and successful answers

test('server mode sends one fixed same-origin request with only cityId and the trimmed customQuery', async () => {
  const cases: Array<[string | undefined, Record<string, unknown>, string]> = [
    ['  Wedding  ', { cityId: 'berlin', customQuery: 'Wedding' }, 'Berlin Wedding'],
    ['   ', { cityId: 'berlin' }, BERLIN_DEFAULT_QUERY],
    [undefined, { cityId: 'berlin' }, BERLIN_DEFAULT_QUERY],
    [' berlin WG-Zimmer ', { cityId: 'berlin', customQuery: 'berlin WG-Zimmer' }, 'berlin WG-Zimmer'],
  ];
  for (const [customQuery, expectedBody, expectedQuery] of cases) {
    const server = fakeServer(() => liveReply(BERLIN, expectedQuery, [hit(1)]));
    const outcome = await search({ customQuery, fetchImpl: server.fetchImpl });
    assert.equal(server.calls.length, 1);
    const [call] = server.calls;
    assert.equal(call.url, ENDPOINT_PATH);
    assert.deepEqual(Object.keys(call.init).sort(), ['body', 'cache', 'credentials', 'headers', 'method', 'mode', 'redirect', 'signal']);
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json' });
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.mode, 'same-origin');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.body, JSON.stringify(expectedBody));
    assert.equal(outcome.result.mode, 'live', String(customQuery));
    assert.equal(outcome.result.query, expectedQuery);
  }
});

test('the eight CITIES identities map to their exact request ids and answer identities', async () => {
  assert.deepEqual(CITIES.map((c) => c.id), CITY_IDS);
  for (const record of CITIES) {
    const query = getCitySearchProfile(record.id)?.defaultQuery ?? '';
    const server = fakeServer(() => liveReply({ id: record.id, name: record.name }, query, [hit(1)]));
    const outcome = await search({ city: record.name, fetchImpl: server.fetchImpl });
    assert.deepEqual(server.calls[0].body, { cityId: record.id });
    assert.equal(outcome.result.mode, 'live', record.id);
    assert.equal(outcome.result.listings[0].cityId, record.id);
    assert.equal(outcome.result.listings[0].cityName, record.name);
  }
});

test('unsupported city strings are refused locally and never reach the server', async () => {
  for (const city of ['Global Metropolises', 'Madrid', '']) {
    const server = fakeServer(() => jsonReply(200, {}));
    const outcome = await search({ city, fetchImpl: server.fetchImpl });
    assertNoCandidates(outcome, 'unsupported', city);
    assert.equal(server.calls.length, 0);
  }
});

test('custom queries over 500 characters are refused locally; 500 characters is allowed', async () => {
  const tooLong = fakeServer(() => jsonReply(200, {}));
  const refused = await search({ customQuery: 'ö'.repeat(501), fetchImpl: tooLong.fetchImpl });
  assertNoCandidates(refused, 'unavailable', 'too long');
  assert.equal(refused.event, 'query_too_long');
  assert.equal(tooLong.calls.length, 0);

  // Counted in Unicode characters like the server: 500 emoji are 1000 UTF-16 units.
  for (const customQuery of ['ö'.repeat(500), '😀'.repeat(500)]) {
    const server = fakeServer((call) => liveReply(BERLIN, `Berlin ${call.body.customQuery as string}`, []));
    const outcome = await search({ customQuery, fetchImpl: server.fetchImpl });
    assert.equal(server.calls.length, 1);
    assert.equal(outcome.result.mode, 'live');
  }
});

test('server live, server demo and empty live answers stay distinct; source text is preserved', async () => {
  const live = await search({
    customQuery: 'Wedding',
    fetchImpl: fakeServer(() =>
      liveReply(BERLIN, 'Berlin Wedding', [hit(1, { score: 0.97, published_date: '2026-06-02' }), hit(2)], {
        answer: '  Unverified provider summary.  ',
      })
    ).fetchImpl,
  });
  assert.equal(live.event, 'live');
  assert.equal(live.result.mode, 'live');
  assert.equal(live.result.demoSource, undefined);
  assert.equal(live.result.rawAnswer, 'Unverified provider summary.');
  assert.deepEqual(
    live.result.listings.map((c) => [c.title, c.sourceUrl, c.description, c.cityId]),
    [
      ['WG-Zimmer 1', 'https://www.wg-gesucht.de/1.html', 'Zwischenmiete 1, 520 € warm', 'berlin'],
      ['WG-Zimmer 2', 'https://www.wg-gesucht.de/2.html', 'Zwischenmiete 2, 520 € warm', 'berlin'],
    ]
  );
  for (const candidate of live.result.listings) {
    for (const field of ['score', 'published_date', 'dealScore', 'priceUsd', 'verifiedDate', 'nemotronAudit']) {
      assert.ok(!(field in candidate), field);
    }
  }

  const empty = await search({ fetchImpl: fakeServer(() => liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [])).fetchImpl });
  assert.equal(empty.result.mode, 'live');
  assert.deepEqual(empty.result.listings, []);
  assert.equal(empty.result.demoSource, undefined);

  const demo = await search({
    fetchImpl: fakeServer(() => jsonReply(200, { mode: 'demo', city: BERLIN, query: BERLIN_DEFAULT_QUERY, results: [] })).fetchImpl,
  });
  assert.equal(demo.event, 'server_demo');
  assert.equal(demo.result.mode, 'demo');
  assert.equal(demo.result.demoSource, 'server');
  assert.equal(demo.result.listings.length, 1);
  assert.equal(demo.result.listings[0].mode, 'demo');
  assert.equal(demo.result.listings[0].cityId, 'berlin');
});

// ---------------------------------------------------------------------------------------------
// Server mode: rejected answers

test('answers for another city or another query are discarded', async () => {
  const cases: Array<[string, unknown, string]> = [
    ['other city id', { mode: 'live', city: { id: 'paris', name: 'Paris' }, query: BERLIN_DEFAULT_QUERY, results: [hit(1)] }, 'city_mismatch'],
    ['other city name', { mode: 'live', city: { id: 'berlin', name: 'Berlin, DE' }, query: BERLIN_DEFAULT_QUERY, results: [hit(1)] }, 'city_mismatch'],
    ['other query', { mode: 'live', city: BERLIN, query: 'Berlin something else', results: [hit(1)] }, 'query_mismatch'],
    ['demo for other city', { mode: 'demo', city: { id: 'tokyo', name: 'Tokyo' }, query: BERLIN_DEFAULT_QUERY, results: [] }, 'city_mismatch'],
    ['demo for other query', { mode: 'demo', city: BERLIN, query: 'Berlin', results: [] }, 'query_mismatch'],
  ];
  for (const [label, body, event] of cases) {
    const outcome = await search({ fetchImpl: fakeServer(() => jsonReply(200, body)).fetchImpl });
    assertNoCandidates(outcome, 'unavailable', label);
    assert.equal(outcome.event, event, label);
  }
});

test('malformed or inconsistent success envelopes are unavailable, never demo or live', async () => {
  const base = { city: BERLIN, query: BERLIN_DEFAULT_QUERY };
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['array', [base]],
    ['string', 'live'],
    ['missing mode', { ...base, results: [] }],
    ['unknown mode', { mode: 'ok', ...base, results: [] }],
    ['unavailable with 200', { mode: 'unavailable', error: 'x' }],
    ['missing results', { mode: 'live', ...base }],
    ['results not an array', { mode: 'live', ...base, results: { 0: hit(1) } }],
    ['missing query', { mode: 'live', city: BERLIN, results: [] }],
    ['numeric query', { mode: 'live', city: BERLIN, query: 7, results: [] }],
    ['missing city', { mode: 'live', query: BERLIN_DEFAULT_QUERY, results: [] }],
    ['city without name', { mode: 'live', city: { id: 'berlin' }, query: BERLIN_DEFAULT_QUERY, results: [] }],
    ['city with extra field', { mode: 'live', city: { ...BERLIN, medianRentUsd: 1800 }, query: BERLIN_DEFAULT_QUERY, results: [] }],
    ['unknown top-level field', { mode: 'live', ...base, results: [], dealScore: 99 }],
    ['non-string answer', { mode: 'live', ...base, results: [], answer: { text: 'x' } }],
    ['demo with results', { mode: 'demo', ...base, results: [hit(1)] }],
    ['demo with answer', { mode: 'demo', ...base, results: [], answer: 'x' }],
  ];
  for (const [label, body] of cases) {
    const outcome = await search({ fetchImpl: fakeServer(() => jsonReply(200, body)).fetchImpl });
    assertNoCandidates(outcome, 'unavailable', label);
    assert.equal(outcome.event, 'malformed_envelope', label);
    assert.equal(outcome.result.error, 'The Scout server returned an unexpected response.', label);
  }
});

test('all-malformed hits are unavailable; mixed lists keep only genuine hits; at most five', async () => {
  const allMalformed = await search({
    fetchImpl: fakeServer(() =>
      liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [
        { url: 'https://wg-gesucht.de/123', title: 17, content: {} },
        { url: 'javascript:alert(1)', title: 'x', content: 'y' },
        { title: 'missing url', content: 'y' },
      ])
    ).fetchImpl,
  });
  assertNoCandidates(allMalformed, 'unavailable', 'all malformed');
  assert.equal(allMalformed.event, 'malformed_results');

  const mixed = await search({
    fetchImpl: fakeServer(() =>
      liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [
        { url: 'https://wg-gesucht.de/123', title: 17, content: {} },
        hit(1),
        { url: 'https://www.kleinanzeigen.de/s-2', title: 'Zimmer Wedding', content: null },
        { url: 'https://www.kleinanzeigen.de/s-3', title: 'Zimmer Moabit', content: '' },
      ])
    ).fetchImpl,
  });
  assert.equal(mixed.result.mode, 'live');
  assert.deepEqual(
    mixed.result.listings.map((c) => [c.title, c.sourceUrl, c.description]),
    [
      ['WG-Zimmer 1', 'https://www.wg-gesucht.de/1.html', 'Zwischenmiete 1, 520 € warm'],
      ['Zimmer Moabit', 'https://www.kleinanzeigen.de/s-3', ''],
    ]
  );

  const many = await search({
    fetchImpl: fakeServer(() => liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [1, 2, 3, 4, 5, 6, 7].map((n) => hit(n)))).fetchImpl,
  });
  assert.equal(many.result.listings.length, 5);
});

test('contract error statuses are unavailable with fixed messages that never echo server text', async () => {
  const expected: Record<number, string> = {
    400: 'The Scout server rejected this search request.',
    403: 'This site is not allowed to use the Scout server.',
    405: 'The Scout server rejected this search request.',
    413: 'The Scout server rejected this search request.',
    415: 'The Scout server rejected this search request.',
    429: 'Too many Scout searches right now. Wait a minute and try again.',
    502: 'The live search provider could not complete this search.',
    503: 'Live search is not available on this server right now.',
    504: 'The live search provider did not answer in time.',
  };
  for (const [status, message] of Object.entries(expected)) {
    const outcome = await search({
      fetchImpl: fakeServer(() => jsonReply(Number(status), { mode: 'unavailable', error: SERVER_DETAIL })).fetchImpl,
    });
    assertNoCandidates(outcome, 'unavailable', status);
    assert.equal(outcome.event, 'server_error_status');
    assert.equal(outcome.status, Number(status));
    assert.equal(outcome.result.error, message);
    assert.ok(!JSON.stringify(outcome).includes(SERVER_DETAIL), `status ${status} echoed server text`);
  }

  const limited = await search({
    fetchImpl: fakeServer(() => jsonReply(429, { mode: 'unavailable', error: 'x' }, { 'Retry-After': '60' })).fetchImpl,
  });
  assert.equal(limited.result.error, 'Too many Scout searches right now. Try again in 60 seconds.');
});

test('unexpected statuses, HTML fallbacks, invalid JSON and network errors are unavailable', async () => {
  const html = (status: number) =>
    new Response('<!doctype html><html><body>RentScanner</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
  const cases: Array<[string, () => Response | Promise<Response>, string]> = [
    ['SPA HTML 200', () => html(200), 'not_json'],
    ['HTML 404', () => html(404), 'unexpected_status'],
    ['HTML 503', () => html(503), 'not_json'],
    ['JSON 500', () => jsonReply(500, { mode: 'unavailable', error: 'x' }), 'unexpected_status'],
    ['JSON 404', () => jsonReply(404, { mode: 'unavailable', error: 'x' }), 'unexpected_status'],
    ['redirect status', () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } }), 'unexpected_status'],
    ['JSON type, invalid JSON', () => new Response('{"mode":"live",', { status: 200, headers: { 'Content-Type': 'application/json' } }), 'not_json'],
    ['no content type', () => new Response('{}', { status: 200 }), 'not_json'],
    ['invalid UTF-8', () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 'body_error'],
    ['non-conforming error body', () => jsonReply(503, { error: 'x' }), 'malformed_envelope'],
    ['error body with extra field', () => jsonReply(503, { mode: 'unavailable', error: 'x', stack: 'y' }), 'malformed_envelope'],
    ['network error', () => Promise.reject(new TypeError('Failed to fetch')), 'network_error'],
  ];
  for (const [label, respond, event] of cases) {
    const outcome = await search({ fetchImpl: fakeServer(respond).fetchImpl });
    assertNoCandidates(outcome, 'unavailable', label);
    assert.equal(outcome.event, event, label);
  }
});

test('answers over 1 MiB are refused, declared or streamed, and the stream is cancelled', async () => {
  const declared = await search({
    fetchImpl: fakeServer(() =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } })
    ).fetchImpl,
  });
  assertNoCandidates(declared, 'unavailable', 'declared');
  assert.equal(declared.event, 'body_too_large');

  const stats = { pulls: 0, cancelled: false };
  const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulls += 1;
      controller.enqueue(chunk.slice());
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  const streamed = await search({
    fetchImpl: fakeServer(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } })).fetchImpl,
  });
  await flush();
  assertNoCandidates(streamed, 'unavailable', 'streamed');
  assert.equal(streamed.event, 'body_too_large');
  assert.equal(stats.cancelled, true);
  assert.ok(stats.pulls * chunk.byteLength <= MAX_RESPONSE_BYTES + 2 * chunk.byteLength, 'stopped soon after the cap');
});

// ---------------------------------------------------------------------------------------------
// Deadline and cancellation

async function withMockTimers<T>(work: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    return await work();
  } finally {
    mock.timers.reset();
  }
}

test('the client deadline is 12 seconds, longer than the server provider deadline, and aborts the request', async () => {
  assert.ok(CLIENT_TIMEOUT_MS > SERVER_PROVIDER_TIMEOUT_MS);
  const server = fakeServer(pendingUntilAborted);
  await withMockTimers(async () => {
    let settled = false;
    const pending = search({ fetchImpl: server.fetchImpl }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await flush();
    mock.timers.tick(CLIENT_TIMEOUT_MS - 1);
    await flush();
    assert.equal(settled, false, 'still waiting just before the deadline');
    mock.timers.tick(1);
    const outcome = await pending;
    assertNoCandidates(outcome, 'unavailable', 'timeout');
    assert.equal(outcome.event, 'timeout');
    assert.equal(outcome.result.error, 'The Scout server did not answer in time.');
  });
  assert.equal(server.calls[0].init.signal.aborted, true);
});

test('the deadline holds even if the transport ignores the abort signal', async () => {
  const server = fakeServer(() => new Promise<Response>(() => undefined));
  await withMockTimers(async () => {
    const pending = search({ fetchImpl: server.fetchImpl });
    await flush();
    mock.timers.tick(CLIENT_TIMEOUT_MS);
    const outcome = await pending;
    assert.equal(outcome.event, 'timeout');
  });
});

test('one deadline spans the request and a stalled response body, which is cancelled', async () => {
  const stats = { cancelled: false };
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"mode":"live",'));
    },
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  const server = fakeServer(() => new Response(stalled, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await withMockTimers(async () => {
    let settled = false;
    const pending = search({ fetchImpl: server.fetchImpl }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await flush();
    mock.timers.tick(6_000);
    await flush();
    assert.equal(settled, false, 'headers arrived but the body is still stalled');
    mock.timers.tick(CLIENT_TIMEOUT_MS - 6_000);
    const outcome = await pending;
    await flush();
    assertNoCandidates(outcome, 'unavailable', 'stalled body');
    assert.equal(outcome.event, 'timeout');
  });
  assert.equal(stats.cancelled, true, 'the stalled body was cancelled');
});

test('caller cancellation aborts the request promptly and is reported as cancelled', async () => {
  const controller = new AbortController();
  const server = fakeServer(pendingUntilAborted);
  const pending = search({ fetchImpl: server.fetchImpl, signal: controller.signal });
  await flush();
  assert.equal(server.calls.length, 1);
  controller.abort();
  const outcome = await pending;
  assertNoCandidates(outcome, 'cancelled', 'caller abort');
  assert.equal(outcome.event, 'cancelled');
  assert.equal(server.calls[0].init.signal.aborted, true);

  const already = new AbortController();
  already.abort();
  const early = fakeServer(() => liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [hit(1)]));
  const refused = await search({ fetchImpl: early.fetchImpl, signal: already.signal });
  assertNoCandidates(refused, 'cancelled', 'pre-aborted');
  assert.equal(early.calls.length, 0);

  // Cancelling while the body is being read also stops the read.
  const bodyStats = { cancelled: false };
  const slowBody = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel() {
      bodyStats.cancelled = true;
    },
  });
  const reading = new AbortController();
  const bodyServer = fakeServer(() => new Response(slowBody, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const bodyPending = search({ fetchImpl: bodyServer.fetchImpl, signal: reading.signal });
  await flush();
  reading.abort();
  assert.equal((await bodyPending).event, 'cancelled');
  await flush();
  assert.equal(bodyStats.cancelled, true);
});

test('a finished search leaves no pending deadline or caller listener behind', async () => {
  const controller = new AbortController();
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
    added.push(listener);
    add(type, listener, options);
  }) as typeof controller.signal.addEventListener;
  controller.signal.removeEventListener = ((type: string, listener: EventListener) => {
    removed.push(listener);
    remove(type, listener);
  }) as typeof controller.signal.removeEventListener;

  const server = fakeServer(() => liveReply(BERLIN, BERLIN_DEFAULT_QUERY, [hit(1)]));
  await withMockTimers(async () => {
    const outcome = await search({ fetchImpl: server.fetchImpl, signal: controller.signal });
    assert.equal(outcome.result.mode, 'live');
    mock.timers.tick(CLIENT_TIMEOUT_MS + 1);
    await flush();
  });
  assert.equal(added.length, 1);
  assert.deepEqual(removed, added, 'the caller listener was removed');
  assert.equal(server.calls[0].init.signal.aborted, false, 'the deadline did not fire after completion');
});

// ---------------------------------------------------------------------------------------------
// End to end over a fake network: client -> Pages adapter -> Worker -> fake provider

interface ProviderCall {
  url: string;
  init: ProviderRequestInit;
  body: Record<string, unknown>;
}

function fakeProvider(respond: () => Response) {
  const calls: ProviderCall[] = [];
  const fetch = ((input: string, init: ProviderRequestInit) => {
    calls.push({ url: String(input), init, body: JSON.parse(init.body) as Record<string, unknown> });
    return Promise.resolve().then(respond);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function limiter(success: boolean): RateLimiter {
  return { limit: () => Promise.resolve({ success }) };
}

/**
 * The browser network as the adapter sees it: same-origin URL and Origin/Sec-Fetch-Site added
 * by the browser, CF-Connecting-IP added by the edge. The adapter reaches the real Worker
 * through a binding; the Worker's provider fetch is the fake provider.
 */
function sameOriginNetwork(pagesEnv: ScoutPagesEnv, provider: ReturnType<typeof fakeProvider>) {
  const sent: ScoutClientRequestInit[] = [];
  const fetchImpl: ScoutClientFetch = async (url, init) => {
    sent.push(init);
    const request = new Request(new URL(url, ORIGIN), {
      method: init.method,
      headers: { ...init.headers, Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': CLIENT_IP },
      body: init.body,
      signal: init.signal,
    });
    globalThis.fetch = provider.fetch;
    try {
      return await onRequest({ request, env: pagesEnv });
    } finally {
      globalThis.fetch = NO_NETWORK;
    }
  };
  return { fetchImpl, sent };
}

const workerBinding = (env: ScoutEnv) => ({ fetch: (request: Request) => scoutWorker.fetch(request, env) });

const liveWorkerEnv = (overrides: Partial<ScoutEnv> = {}): ScoutEnv => ({
  TAVILY_API_KEY: FAKE_KEY,
  SCOUT_ALLOWED_ORIGIN: ORIGIN,
  SCOUT_CLIENT_LIMITER: limiter(true),
  SCOUT_GLOBAL_LIMITER: limiter(true),
  ...overrides,
});

test('end to end: Worker live answer reaches the client as truthful live candidates', async () => {
  const provider = fakeProvider(
    () =>
      new Response(
        JSON.stringify({
          answer: 'Provider summary',
          results: [{ url: 'https://wg-gesucht.de/9', title: 9, content: {} }, hit(1), hit(2)],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
  );
  const network = sameOriginNetwork({ SCOUT_BACKEND: workerBinding(liveWorkerEnv()) }, provider);
  const outcome = await search({ customQuery: '  Wedding ', fetchImpl: network.fetchImpl });

  assert.equal(outcome.event, 'live');
  assert.equal(outcome.result.query, 'Berlin Wedding');
  assert.equal(outcome.result.rawAnswer, 'Provider summary');
  assert.deepEqual(outcome.result.listings.map((c) => c.sourceUrl), ['https://www.wg-gesucht.de/1.html', 'https://www.wg-gesucht.de/2.html']);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].body.query, 'Berlin Wedding');
  assert.equal(provider.calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  // The key exists only in the Worker environment, never in what the client sent.
  assert.ok(!JSON.stringify(network.sent).includes(FAKE_KEY));
  assert.deepEqual(JSON.parse(network.sent[0].body), { cityId: 'berlin', customQuery: 'Wedding' });
});

test('end to end: a Worker without a key answers demo; the client shows a server demo sample', async () => {
  const provider = fakeProvider(() => new Response('{}'));
  const network = sameOriginNetwork({ SCOUT_BACKEND: workerBinding({}) }, provider);
  for (const record of CITIES) {
    const outcome = await search({ city: record.name, fetchImpl: network.fetchImpl });
    assert.equal(outcome.event, 'server_demo', record.id);
    assert.equal(outcome.result.demoSource, 'server');
    assert.equal(outcome.result.listings[0].cityId, record.id);
  }
  assert.equal(provider.calls.length, 0);
});

test('end to end: missing binding, provider failure and rate limits never become demo or live', async () => {
  const failingProvider = fakeProvider(() => new Response(JSON.stringify({ detail: SERVER_DETAIL }), { status: 500 }));

  const unbound = await search({ fetchImpl: sameOriginNetwork({}, failingProvider).fetchImpl });
  assertNoCandidates(unbound, 'unavailable', 'no binding');
  assert.equal(unbound.status, 503);

  const failed = await search({
    fetchImpl: sameOriginNetwork({ SCOUT_BACKEND: workerBinding(liveWorkerEnv()) }, failingProvider).fetchImpl,
  });
  assertNoCandidates(failed, 'unavailable', 'provider 500');
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(failed).includes(SERVER_DETAIL));
  assert.equal(failingProvider.calls.length, 1);

  const limited = await search({
    fetchImpl: sameOriginNetwork(
      { SCOUT_BACKEND: workerBinding(liveWorkerEnv({ SCOUT_CLIENT_LIMITER: limiter(false) })) },
      failingProvider
    ).fetchImpl,
  });
  assertNoCandidates(limited, 'unavailable', 'rate limited');
  assert.equal(limited.status, 429);
  assert.equal(limited.result.error, 'Too many Scout searches right now. Try again in 60 seconds.');
  assert.equal(failingProvider.calls.length, 1, 'the limited request made no provider call');
});

// Node 22 prints this through console.error when tests enable mock timers.
const NODE_MOCK_TIMERS_WARNING = /^\(node:\d+\) ExperimentalWarning: The MockTimers API is an experimental feature/;

after(() => {
  // Only the Worker logs here; its lines are fixed events with no key or provider text.
  for (const line of logLines.filter((entry) => !NODE_MOCK_TIMERS_WARNING.test(entry))) {
    assert.ok(!line.includes(FAKE_KEY) && !line.includes(SERVER_DETAIL) && !line.includes('Wedding'), line);
    const event = JSON.parse(line) as Record<string, unknown>;
    assert.equal(typeof event.scout, 'string', line);
  }
});
