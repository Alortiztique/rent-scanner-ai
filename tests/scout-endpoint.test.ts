// Offline checks for the private Scout Worker (worker/scout.ts) and its same-origin Pages
// adapter (functions/api/scout.ts), through their real runtime entry points: the Worker's
// default fetch handler and the adapter's onRequest. Every provider, rate limiter and service
// binding is a fake. The provider fake is installed as the global fetch only while a request
// is handled; at all other times the global fetch throws, so no real network call can happen.
// Run: node --experimental-strip-types --test tests/scout-endpoint.test.ts
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../src/data/cities.ts';
import { TAVILY_SEARCH_ENDPOINT, getCitySearchProfile } from '../src/services/tavilySearch.ts';
import scoutWorker from '../worker/scout.ts';
import type { ProviderRequestInit, RateLimiter, ScoutEnv } from '../worker/scout.ts';
import { onRequest } from '../functions/api/scout.ts';
import type { ScoutPagesEnv, ServiceBinding } from '../functions/api/scout.ts';

// Contract limits, stated independently of the implementation.
const MAX_REQUEST_BYTES = 4096;
const MAX_CUSTOM_QUERY_CHARS = 500;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;
const CITY_IDS = ['nyc', 'london', 'tokyo', 'bogota', 'dubai', 'paris', 'berlin', 'sf'];

const ORIGIN = 'https://rentscanner.example';
const ENDPOINT = `${ORIGIN}/api/scout`;
// RFC 5737 / RFC 3849 documentation addresses; never real clients.
const CLIENT_IP = '203.0.113.7';
const ADDRESS_MARKERS = ['203.0.113.', '198.51.100.', '2001:db8:'];
const FAKE_KEY = 'tvly-FAKE-offline-test-key-0001';
const PROVIDER_SECRET = 'provider-internal-detail-7f3a';
const PRIVATE_QUERY = 'private-query-marker-6c1d';
const BERLIN = { id: 'berlin', name: 'Berlin' };
const BERLIN_PROFILE = getCitySearchProfile('berlin');
assert.ok(BERLIN_PROFILE);

const NO_NETWORK = (() => {
  throw new Error('real network access is disabled in scout-endpoint tests');
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

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
  origin?: string | null;
  site?: string | null;
  contentType?: string | null;
  clientIp?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function scoutRequest(options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  const put = (name: string, value: string | null | undefined, fallback: string) => {
    const resolved = value === undefined ? fallback : value;
    if (resolved !== null) headers.set(name, resolved);
  };
  put('Origin', options.origin, ORIGIN);
  put('Sec-Fetch-Site', options.site, 'same-origin');
  put('Content-Type', options.contentType, 'application/json');
  put('CF-Connecting-IP', options.clientIp, CLIENT_IP);

  const method = options.method ?? 'POST';
  let body = options.body;
  if (body === undefined) {
    body = method === 'GET' || method === 'HEAD' ? null : JSON.stringify(options.json ?? { cityId: 'berlin' });
  }
  const init = { method, headers, body, signal: options.signal, duplex: 'half' } as RequestInit;
  return new Request(ENDPOINT, init);
}

type LimiterBehavior = 'allow' | 'deny' | 'throw' | 'malformed';

function fakeLimiter(behavior: LimiterBehavior = 'allow'): { limiter: RateLimiter; keys: string[] } {
  const keys: string[] = [];
  const limiter: RateLimiter = {
    limit({ key }) {
      keys.push(key);
      if (behavior === 'throw') return Promise.reject(new Error(`limiter failed for ${key}`));
      if (behavior === 'malformed') return Promise.resolve({} as { success: boolean });
      return Promise.resolve({ success: behavior === 'allow' });
    },
  };
  return { limiter, keys };
}

/** Counts per key like a native limit within one location and one period. */
function countingLimiter(limit: number): { limiter: RateLimiter; keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const limiter: RateLimiter = {
    limit({ key }) {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ success: count <= limit });
    },
  };
  return { limiter, keys };
}

function liveEnv(overrides: Partial<ScoutEnv> = {}) {
  const client = fakeLimiter();
  const global = fakeLimiter();
  const env: ScoutEnv = {
    TAVILY_API_KEY: FAKE_KEY,
    SCOUT_ALLOWED_ORIGIN: ORIGIN,
    SCOUT_CLIENT_LIMITER: client.limiter,
    SCOUT_GLOBAL_LIMITER: global.limiter,
    ...overrides,
  };
  return { env, client, global };
}

interface ProviderCall {
  url: string;
  init: ProviderRequestInit;
  body: Record<string, unknown>;
}

interface FakeProvider {
  fetch: typeof fetch;
  calls: ProviderCall[];
}

function fakeProvider(respond: (call: ProviderCall) => Response | Promise<Response>): FakeProvider {
  const calls: ProviderCall[] = [];
  const fetch = ((input: string, init: ProviderRequestInit) => {
    const call: ProviderCall = { url: String(input), init, body: JSON.parse(init.body) };
    calls.push(call);
    return Promise.resolve().then(() => respond(call));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Runs `work` with the fake provider as the global fetch, restoring the guard afterwards. */
async function withProvider<T>(provider: FakeProvider | undefined, work: () => Promise<T>): Promise<T> {
  globalThis.fetch = provider?.fetch ?? NO_NETWORK;
  try {
    return await work();
  } finally {
    globalThis.fetch = NO_NETWORK;
  }
}

const runWorker = (request: Request, env: ScoutEnv, provider?: FakeProvider) =>
  withProvider(provider, () => scoutWorker.fetch(request, env));

const providerJson = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const hit = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `WG-Zimmer ${n}`,
  url: `https://www.wg-gesucht.de/${n}.html`,
  content: `Zwischenmiete ${n}`,
  ...extra,
});

/** Rejects with AbortError when the Worker aborts the provider request. */
const pendingUntilAborted = (call: ProviderCall) =>
  new Promise<Response>((_, reject) => {
    call.init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

/** A byte stream that records how much was pulled and whether it was cancelled. */
function trackedStream(chunk: Uint8Array, options: { maxChunks?: number } = {}) {
  const stats = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulls += 1;
      if (stats.pulls > (options.maxChunks ?? Number.POSITIVE_INFINITY)) {
        controller.close();
        return undefined;
      }
      controller.enqueue(chunk.slice());
      return undefined;
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { stream, stats };
}

const encoder = new TextEncoder();
const flush = async (turns = 5) => {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

/** Checks the headers every Scout response must carry and that nothing private leaks. */
async function readReply(response: Response): Promise<Reply> {
  const text = await response.text();
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  const exposed = `${text}\n${[...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n')}`;
  for (const secret of [FAKE_KEY, PROVIDER_SECRET, ...ADDRESS_MARKERS]) {
    assert.ok(!exposed.includes(secret), `response exposed ${secret}`);
  }
  assert.ok(!/\bat\s+\S+\s+\(|Error:|TypeError|DOMException/.test(exposed), 'response exposed an exception');

  const body = JSON.parse(text) as Record<string, unknown>;
  if (body.mode === 'unavailable') {
    assert.deepEqual(Object.keys(body).sort(), ['error', 'mode']);
    assert.equal(typeof body.error, 'string');
    assert.ok(!exposed.includes(PRIVATE_QUERY), 'error response exposed the private query');
  }
  return { status: response.status, headers: response.headers, body };
}

async function expectUnavailable(response: Response, status: number): Promise<Reply> {
  const reply = await readReply(response);
  assert.equal(reply.status, status);
  assert.equal(reply.body.mode, 'unavailable');
  return reply;
}

// ---------------------------------------------------------------------------------------------
// Worker: success, request construction and city coverage

test('Worker serves exactly the eight existing CITIES ids with each localized default request', async () => {
  assert.deepEqual(CITIES.map((city) => city.id), CITY_IDS);

  for (const record of CITIES) {
    const profile = getCitySearchProfile(record.id);
    assert.ok(profile, record.id);
    const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
    const reply = await readReply(await runWorker(scoutRequest({ json: { cityId: record.id } }), liveEnv().env, provider));
    assert.equal(reply.status, 200, record.id);
    assert.equal(reply.body.mode, 'live', record.id);
    assert.deepEqual(reply.body.city, { id: record.id, name: record.name });
    assert.equal(reply.body.query, profile.defaultQuery);
    assert.equal(provider.calls.length, 1, record.id);
    assert.equal(provider.calls[0].body.query, profile.defaultQuery);
    assert.deepEqual(provider.calls[0].body.include_domains, [...profile.includeDomains]);
  }
});

test('Berlin without customQuery sends one fixed provider request and returns the normalized contract', async () => {
  const provider = fakeProvider(() =>
    providerJson({
      query: 'echoed by provider',
      answer: '  Unverified provider summary.  ',
      response_time: 1.2,
      request_id: PROVIDER_SECRET,
      results: [hit(1, { score: 0.81, published_date: '2026-10-01' }), hit(2)],
    })
  );
  const { env, client, global } = liveEnv();
  const reply = await readReply(await runWorker(scoutRequest(), env, provider));

  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    mode: 'live',
    city: BERLIN,
    query: BERLIN_PROFILE.defaultQuery,
    results: [
      { title: 'WG-Zimmer 1', url: 'https://www.wg-gesucht.de/1.html', content: 'Zwischenmiete 1', score: 0.81, published_date: '2026-10-01' },
      { title: 'WG-Zimmer 2', url: 'https://www.wg-gesucht.de/2.html', content: 'Zwischenmiete 2' },
    ],
    answer: 'Unverified provider summary.',
  });

  assert.equal(provider.calls.length, 1);
  const [call] = provider.calls;
  assert.equal(call.url, TAVILY_SEARCH_ENDPOINT);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${FAKE_KEY}` });
  assert.deepEqual(call.body, {
    query: BERLIN_PROFILE.defaultQuery,
    search_depth: 'advanced',
    include_answer: true,
    max_results: 5,
    include_domains: ['wg-gesucht.de', 'kleinanzeigen.de', 'reddit.com'],
  });
  assert.ok(!call.init.body.includes(FAKE_KEY), 'the key travels only in the Authorization header');

  assert.deepEqual(client.keys, [`client:${CLIENT_IP}`]);
  assert.deepEqual(global.keys, ['global']);
});

test('customQuery is trimmed and city-scoped; blank uses the default; 500 characters is the limit', async () => {
  const cases: Array<[unknown, string]> = [
    [{ cityId: 'berlin', customQuery: '  Zwischenmiete Neukölln  ' }, 'Berlin Zwischenmiete Neukölln'],
    [{ cityId: 'berlin', customQuery: ' berlin WG-Zimmer ' }, 'berlin WG-Zimmer'],
    [{ cityId: 'berlin', customQuery: '' }, BERLIN_PROFILE.defaultQuery],
    [{ cityId: 'berlin', customQuery: ' \t\n ' }, BERLIN_PROFILE.defaultQuery],
    [{ cityId: 'berlin', customQuery: '€'.repeat(MAX_CUSTOM_QUERY_CHARS) }, `Berlin ${'€'.repeat(500)}`],
    [{ cityId: 'berlin', customQuery: '😀'.repeat(MAX_CUSTOM_QUERY_CHARS) }, `Berlin ${'😀'.repeat(500)}`],
  ];
  for (const [json, expectedQuery] of cases) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const reply = await readReply(await runWorker(scoutRequest({ json }), liveEnv().env, provider));
    assert.equal(reply.status, 200, JSON.stringify(json).slice(0, 60));
    assert.equal(reply.body.query, expectedQuery);
    assert.equal(provider.calls[0].body.query, expectedQuery);
  }

  for (const customQuery of ['€'.repeat(501), '😀'.repeat(501), `${PRIVATE_QUERY}${'x'.repeat(500)}`]) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const { env, client } = liveEnv();
    const reply = await expectUnavailable(await runWorker(scoutRequest({ json: { cityId: 'berlin', customQuery } }), env, provider), 400);
    assert.match(String(reply.body.error), /at most 500 characters/);
    assert.equal(provider.calls.length, 0);
    assert.equal(client.keys.length, 0);
  }
});

test('no server key is explicit demo with the same city/query and zero provider or limiter calls', async () => {
  for (const key of [undefined, '', '   ', 'your_tavily_api_key_here']) {
    const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
    const { env, client, global } = liveEnv({ TAVILY_API_KEY: key });
    const reply = await readReply(await runWorker(scoutRequest(), env, provider));
    assert.equal(reply.status, 200, String(key));
    assert.deepEqual(reply.body, { mode: 'demo', city: BERLIN, query: BERLIN_PROFILE.defaultQuery, results: [] });
    assert.equal(provider.calls.length, 0);
    assert.equal(client.keys.length + global.keys.length, 0);
  }

  // Demo needs no limiter, identity or origin configuration and still makes no call.
  const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
  const reply = await readReply(
    await runWorker(scoutRequest({ json: { cityId: 'tokyo', customQuery: ' シェアハウス ' }, clientIp: null }), {}, provider)
  );
  assert.deepEqual(reply.body, { mode: 'demo', city: { id: 'tokyo', name: 'Tokyo' }, query: 'Tokyo シェアハウス', results: [] });
  assert.equal(provider.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Worker: request validation (all with a configured key, so any provider call would be a bug)

test('Worker accepts only POST and answers 405 with Allow: POST', async () => {
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const response = await runWorker(scoutRequest({ method }), liveEnv().env, provider);
    assert.equal(response.headers.get('Allow'), 'POST', method);
    if (method !== 'HEAD') await expectUnavailable(response, 405);
    else assert.equal(response.status, 405);
    assert.equal(provider.calls.length, 0, method);
  }
});

test('Worker requires the exact configured origin and rejects hostile Sec-Fetch-Site', async () => {
  const rejected: RequestOptions[] = [
    { origin: null },
    { origin: 'null' },
    { origin: 'https://evil.example' },
    { origin: `${ORIGIN}/` },
    { origin: 'http://rentscanner.example' },
    { origin: 'https://rentscanner.example:8443' },
    { origin: 'https://preview.rentscanner.example' },
    { site: 'cross-site' },
    { site: 'same-site' },
    { site: 'none' },
  ];
  for (const options of rejected) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const { env, client } = liveEnv();
    await expectUnavailable(await runWorker(scoutRequest(options), env, provider), 403);
    assert.equal(provider.calls.length + client.keys.length, 0, JSON.stringify(options));
  }

  // Sec-Fetch-Site may be absent (older browsers); Origin is still required and exact.
  const provider = fakeProvider(() => providerJson({ results: [] }));
  assert.equal((await readReply(await runWorker(scoutRequest({ site: null }), liveEnv().env, provider))).status, 200);

  // A wildcard or malformed configured origin is a configuration error, never "allow all".
  for (const configured of ['*', `${ORIGIN}/`, `${ORIGIN}/api`, 'rentscanner.example', 'ftp://rentscanner.example']) {
    const misconfigured = fakeProvider(() => providerJson({ results: [] }));
    await expectUnavailable(await runWorker(scoutRequest(), liveEnv({ SCOUT_ALLOWED_ORIGIN: configured }).env, misconfigured), 503);
    assert.equal(misconfigured.calls.length, 0, configured);
  }
});

test('Worker requires application/json', async () => {
  for (const contentType of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', 'json']) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    await expectUnavailable(await runWorker(scoutRequest({ contentType }), liveEnv().env, provider), 415);
    assert.equal(provider.calls.length, 0, String(contentType));
  }
  for (const contentType of ['application/json; charset=utf-8', 'Application/JSON']) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    assert.equal((await readReply(await runWorker(scoutRequest({ contentType }), liveEnv().env, provider))).status, 200);
  }
});

test('malformed bodies, extra fields and wrong types are 400 with zero provider calls', async () => {
  const bodies: Array<string | Uint8Array> = [
    '',
    '{',
    'not json',
    'null',
    '42',
    '"berlin"',
    '[{"cityId":"berlin"}]',
    '{}',
    new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]),
  ];
  const objects: unknown[] = [
    { cityId: 'berlin', api_key: 'tvly-attacker-key' },
    { cityId: 'berlin', apiKey: 'tvly-attacker-key' },
    { cityId: 'berlin', include_domains: ['evil.example'] },
    { cityId: 'berlin', max_results: 20 },
    { cityId: 'berlin', search_depth: 'basic' },
    { cityId: 'berlin', include_raw_content: true },
    { cityId: 'berlin', url: 'https://evil.example/search' },
    { cityId: 'berlin', endpoint: 'https://evil.example' },
    { cityId: 'berlin', model: 'gpt' },
    { cityId: 'berlin', cityName: 'Berlin' },
    { city: 'berlin' },
    { cityId: 7 },
    { cityId: null },
    { cityId: ['berlin'] },
    { cityId: { id: 'berlin' } },
    { cityId: 'berlin', customQuery: null },
    { cityId: 'berlin', customQuery: 42 },
    { cityId: 'berlin', customQuery: ['WG'] },
    { cityId: 'berlin', customQuery: { q: 'WG' } },
    { cityId: 'berlin', customQuery: true },
  ];
  const cases = [...bodies, ...objects.map((value) => JSON.stringify(value)), '{"cityId":"berlin","__proto__":{"x":1}}'];
  for (const body of cases) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const { env, client } = liveEnv();
    const reply = await expectUnavailable(await runWorker(scoutRequest({ body }), env, provider), 400);
    assert.ok(!String(reply.body.error).includes('attacker'), 'the error does not echo input');
    assert.equal(provider.calls.length + client.keys.length, 0, String(body));
  }
});

test('only the eight exact city ids are valid', async () => {
  for (const cityId of ['', ' berlin', 'berlin ', 'Berlin', 'BERLIN', 'New York City', 'madrid', 'global', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const provider = fakeProvider(() => providerJson({ results: [] }));
    const reply = await expectUnavailable(await runWorker(scoutRequest({ json: { cityId } }), liveEnv().env, provider), 400);
    assert.equal(reply.body.error, `cityId must be one of: ${CITY_IDS.join(', ')}.`);
    assert.equal(provider.calls.length, 0, cityId);
  }
});

test('request bodies over 4096 bytes are refused, including chunked streams, which are cancelled', async () => {
  const base = JSON.stringify({ cityId: 'berlin' });

  const exact = base + ' '.repeat(MAX_REQUEST_BYTES - base.length);
  const okProvider = fakeProvider(() => providerJson({ results: [] }));
  assert.equal((await readReply(await runWorker(scoutRequest({ body: exact }), liveEnv().env, okProvider))).status, 200);

  const overByOne = fakeProvider(() => providerJson({ results: [] }));
  await expectUnavailable(await runWorker(scoutRequest({ body: `${exact} ` }), liveEnv().env, overByOne), 413);
  assert.equal(overByOne.calls.length, 0);

  // Declared length over the limit: refused before anything is read.
  const declared = trackedStream(encoder.encode(' '.repeat(1024)), { maxChunks: 2 });
  const declaredProvider = fakeProvider(() => providerJson({ results: [] }));
  await expectUnavailable(
    await runWorker(scoutRequest({ body: declared.stream, headers: { 'Content-Length': '5000' } }), liveEnv().env, declaredProvider),
    413
  );
  assert.equal(declaredProvider.calls.length, 0);
  assert.ok(declared.stats.pulls <= 1, 'declared oversize was not read');

  // Chunked body without Content-Length that never ends: cancelled just past the limit.
  const chunked = trackedStream(encoder.encode(`{"cityId":"berlin","customQuery":"${'a'.repeat(1000)}`));
  const chunkedProvider = fakeProvider(() => providerJson({ results: [] }));
  await expectUnavailable(await runWorker(scoutRequest({ body: chunked.stream }), liveEnv().env, chunkedProvider), 413);
  assert.equal(chunkedProvider.calls.length, 0);
  assert.equal(chunked.stats.cancelled, true);
  assert.ok(chunked.stats.pulls <= 7, `pulled ${chunked.stats.pulls} chunks`);
});

// ---------------------------------------------------------------------------------------------
// Worker: provider results and failures

test('provider results: mixed keeps genuine hits, empty stays empty, all-malformed is unavailable', async () => {
  const run = async (payload: unknown) =>
    readReply(await runWorker(scoutRequest(), liveEnv().env, fakeProvider(() => providerJson(payload))));

  const mixed = await run({
    images: ['https://img.example/1.jpg'],
    results: [
      { url: 'https://wg-gesucht.de/123', title: 17, content: {} },
      hit(1, { raw_content: PROVIDER_SECRET, favicon: 'https://wg-gesucht.de/favicon.ico', images: [] }),
      { url: 'javascript:alert(1)', title: 'bad', content: '' },
      { url: 'https://kleinanzeigen.de/s-4', title: 'Zimmer Wedding', content: null },
      { url: 'https://kleinanzeigen.de/s-4', title: 'Zimmer Wedding', content: 'Untermiete ab sofort.' },
    ],
  });
  assert.equal(mixed.status, 200);
  assert.deepEqual(mixed.body, {
    mode: 'live',
    city: BERLIN,
    query: BERLIN_PROFILE.defaultQuery,
    results: [
      { title: 'WG-Zimmer 1', url: 'https://www.wg-gesucht.de/1.html', content: 'Zwischenmiete 1' },
      { title: 'Zimmer Wedding', url: 'https://kleinanzeigen.de/s-4', content: 'Untermiete ab sofort.' },
    ],
  });

  const empty = await run({ answer: '   ', results: [] });
  assert.deepEqual(empty.body, { mode: 'live', city: BERLIN, query: BERLIN_PROFILE.defaultQuery, results: [] });

  const capped = await run({ results: [1, 2, 3, 4, 5, 6, 7].map((n) => hit(n)) });
  assert.deepEqual(
    (capped.body.results as Array<{ url: string }>).map((result) => result.url),
    [1, 2, 3, 4, 5].map((n) => `https://www.wg-gesucht.de/${n}.html`)
  );

  for (const payload of [
    { results: [{ url: 'https://wg-gesucht.de/123', title: 17, content: {} }, { url: 'https://wg-gesucht.de/1', title: '  ' }] },
    { results: 'none' },
    { answer: PROVIDER_SECRET },
    [],
    null,
  ]) {
    const reply = await run(payload);
    assert.equal(reply.status, 502, JSON.stringify(payload));
    assert.equal(reply.body.error, 'The live search provider returned an unusable response.');
  }
});

test('provider network, redirect, HTTP and payload failures are 502 after exactly one request', async () => {
  const failures: Array<[string, (call: ProviderCall) => Response | Promise<Response>]> = [
    ['network error', () => Promise.reject(new TypeError(`fetch failed: ${FAKE_KEY} ${PROVIDER_SECRET}`))],
    ['302 redirect', () => new Response(PROVIDER_SECRET, { status: 302, headers: { Location: 'https://evil.example/' } })],
    ['307 redirect', () => new Response(null, { status: 307, headers: { Location: 'https://api.tavily.com/other' } })],
    ['401', () => providerJson({ detail: PROVIDER_SECRET }, 401)],
    ['429', () => providerJson({ detail: PROVIDER_SECRET }, 429, { 'Retry-After': '3600' })],
    ['500', () => new Response(`<html>${PROVIDER_SECRET}</html>`, { status: 500 })],
    ['not JSON', () => new Response(`oops ${PROVIDER_SECRET}`, { status: 200 })],
    ['empty body', () => new Response(null, { status: 200 })],
    ['invalid UTF-8', () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 })],
  ];
  for (const [label, respond] of failures) {
    const provider = fakeProvider(respond);
    const request = scoutRequest({ json: { cityId: 'berlin', customQuery: PRIVATE_QUERY } });
    const reply = await readReply(await runWorker(request, liveEnv().env, provider));
    assert.equal(reply.status, 502, label);
    assert.equal(reply.body.mode, 'unavailable', label);
    assert.equal(reply.headers.get('Retry-After'), null, label);
    assert.equal(provider.calls.length, 1, `${label}: no retry or redirect follow`);
    assert.equal(provider.calls[0].init.redirect, 'manual');
  }

  // Error and redirect bodies are cancelled, not left open.
  for (const status of [302, 500]) {
    const errorBody = trackedStream(encoder.encode(PROVIDER_SECRET), { maxChunks: 1 });
    const provider = fakeProvider(() => new Response(errorBody.stream, { status }));
    await expectUnavailable(await runWorker(scoutRequest(), liveEnv().env, provider), 502);
    await flush();
    assert.equal(errorBody.stats.cancelled, true, String(status));
  }
});

test('provider bodies over 512 KiB are refused and cancelled, declared or streamed', async () => {
  const declared = trackedStream(encoder.encode('{"results":[]}'), { maxChunks: 1 });
  const declaredProvider = fakeProvider(
    () => new Response(declared.stream, { status: 200, headers: { 'Content-Length': String(MAX_PROVIDER_BODY_BYTES + 1) } })
  );
  await expectUnavailable(await runWorker(scoutRequest(), liveEnv().env, declaredProvider), 502);
  await flush();
  assert.equal(declared.stats.cancelled, true);
  assert.ok(declared.stats.pulls <= 1);

  const streamed = trackedStream(new Uint8Array(64 * 1024).fill(0x20));
  const streamedProvider = fakeProvider(() => new Response(streamed.stream, { status: 200 }));
  await expectUnavailable(await runWorker(scoutRequest(), liveEnv().env, streamedProvider), 502);
  await flush();
  assert.equal(streamed.stats.cancelled, true);
  assert.ok(streamed.stats.pulls <= 10, `pulled ${streamed.stats.pulls} chunks`);

  // Exactly at the limit is accepted (whitespace-padded valid JSON).
  const payload = JSON.stringify({ results: [hit(1)] });
  const padded = payload + ' '.repeat(MAX_PROVIDER_BODY_BYTES - payload.length);
  const exact = await readReply(await runWorker(scoutRequest(), liveEnv().env, fakeProvider(() => new Response(padded, { status: 200 }))));
  assert.equal(exact.status, 200);
});

/**
 * Starts a live request with mocked timers, waits until `ready` resolves (the provider was
 * called, or its body is being read), checks nothing has answered just before 10 seconds,
 * then advances to exactly 10 seconds and returns the answer.
 */
async function runPastProviderTimeout(provider: FakeProvider, ready: Promise<void>): Promise<Response> {
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = provider.fetch;
  try {
    let settled = false;
    const pending = scoutWorker.fetch(scoutRequest(), liveEnv().env).then((response) => {
      settled = true;
      return response;
    });
    await ready;
    await flush();
    mock.timers.tick(PROVIDER_TIMEOUT_MS - 1);
    await flush();
    assert.equal(settled, false, 'still waiting just before 10 seconds');
    mock.timers.tick(1);
    return await pending;
  } finally {
    globalThis.fetch = NO_NETWORK;
    mock.timers.reset();
  }
}

function signalWhen<T extends unknown[]>(handler: (...args: T) => Response | Promise<Response>) {
  let reached: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return {
    ready,
    handler: (...args: T) => {
      reached();
      return handler(...args);
    },
  };
}

test('the 10-second provider timeout aborts a pending request: 504', async () => {
  const gate = signalWhen(pendingUntilAborted);
  const provider = fakeProvider(gate.handler);
  await expectUnavailable(await runPastProviderTimeout(provider, gate.ready), 504);
  assert.equal(provider.calls[0].init.signal.aborted, true);
});

test('the timeout holds even when the transport ignores the abort signal', async () => {
  const gate = signalWhen(() => new Promise<Response>(() => undefined));
  const provider = fakeProvider(gate.handler);
  await expectUnavailable(await runPastProviderTimeout(provider, gate.ready), 504);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].init.signal.aborted, true);
});

test('one 10-second budget spans the request and the body read; a stalled body is cancelled', async () => {
  // Headers arrive at 6 s and the body then stalls: the answer is due at 10 s, not 16 s.
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"results":'));
    },
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      cancelled = true;
    },
  });
  let releaseHeaders: () => void = () => undefined;
  const headersReleased = new Promise<void>((resolve) => {
    releaseHeaders = resolve;
  });
  const gate = signalWhen(() => headersReleased.then(() => new Response(body, { status: 200 })));
  const provider = fakeProvider(gate.handler);

  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = provider.fetch;
  try {
    let settled = false;
    const pending = scoutWorker.fetch(scoutRequest(), liveEnv().env).then((response) => {
      settled = true;
      return response;
    });
    await gate.ready;
    mock.timers.tick(6_000);
    releaseHeaders();
    await flush();
    assert.equal(settled, false, 'reading the stalled body at 6 s');
    mock.timers.tick(PROVIDER_TIMEOUT_MS - 6_000 - 1);
    await flush();
    assert.equal(settled, false, 'still reading just before 10 s');
    mock.timers.tick(1);
    await expectUnavailable(await pending, 504);
  } finally {
    globalThis.fetch = NO_NETWORK;
    mock.timers.reset();
  }
  await flush();
  assert.equal(cancelled, true);
  assert.equal(provider.calls[0].init.signal.aborted, true);
});

test('a finished provider call leaves no timer or abort listener behind', async () => {
  let added = 0;
  let removed = 0;
  const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = provider.fetch;
  try {
    // Count listeners on the signal the Worker sees (request.signal).
    const request = scoutRequest({ signal: new AbortController().signal });
    const requestSignal = request.signal;
    const wrappedAdd = requestSignal.addEventListener.bind(requestSignal);
    const wrappedRemove = requestSignal.removeEventListener.bind(requestSignal);
    requestSignal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => {
      if (args[0] === 'abort') added += 1;
      wrappedAdd(...args);
    }) as AbortSignal['addEventListener'];
    requestSignal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => {
      if (args[0] === 'abort') removed += 1;
      wrappedRemove(...args);
    }) as AbortSignal['removeEventListener'];

    const logsBefore = logLines.length;
    const reply = await readReply(await scoutWorker.fetch(request, liveEnv().env));
    assert.equal(reply.body.mode, 'live');
    let timedOutLater = false;
    const probe = setTimeout(() => {
      timedOutLater = true;
    }, PROVIDER_TIMEOUT_MS + 1);
    mock.timers.tick(PROVIDER_TIMEOUT_MS + 1);
    clearTimeout(probe);
    assert.equal(timedOutLater, true, 'mocked clock advanced past the provider timeout');
    assert.deepEqual(logLines.slice(logsBefore), [], 'no stray timeout fired after the answer');
    assert.equal(provider.calls[0].init.signal.aborted, false, 'the cleared timer did not abort a finished request');
    assert.ok(added > 0, 'a caller-abort listener was registered');
    assert.equal(removed, added, 'every caller-abort listener was removed');
  } finally {
    globalThis.fetch = NO_NETWORK;
    mock.timers.reset();
  }
});

test('caller abort cancels the provider request and never falls back to samples', async () => {
  const controller = new AbortController();
  const gate = signalWhen(pendingUntilAborted);
  const provider = fakeProvider(gate.handler);
  const reply = await withProvider(provider, async () => {
    const pending = scoutWorker.fetch(scoutRequest({ signal: controller.signal }), liveEnv().env);
    await gate.ready;
    controller.abort();
    return expectUnavailable(await pending, 502);
  });
  assert.equal(reply.body.error, 'The Scout search was cancelled before it finished.');
  assert.equal(provider.calls[0].init.signal.aborted, true);

  const early = new AbortController();
  early.abort();
  const earlyProvider = fakeProvider(() => providerJson({ results: [hit(1)] }));
  const { env, client } = liveEnv();
  await expectUnavailable(await runWorker(scoutRequest({ signal: early.signal }), env, earlyProvider), 502);
  assert.equal(earlyProvider.calls.length + client.keys.length, 0);

  // Aborted while the limit checks were awaited: still no provider request.
  const during = new AbortController();
  const abortingLimiter: RateLimiter = {
    limit() {
      during.abort();
      return Promise.resolve({ success: true });
    },
  };
  const duringProvider = fakeProvider(() => providerJson({ results: [hit(1)] }));
  const duringEnv = liveEnv({ SCOUT_GLOBAL_LIMITER: abortingLimiter }).env;
  await expectUnavailable(await runWorker(scoutRequest({ signal: during.signal }), duringEnv, duringProvider), 502);
  assert.equal(duringProvider.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Worker: live configuration, identity and rate limits fail closed

test('live mode without origin configuration, limiter bindings or client identity is 503 with zero calls', async () => {
  const configs: Array<[string, Partial<ScoutEnv>, RequestOptions?]> = [
    ['no allowed origin', { SCOUT_ALLOWED_ORIGIN: undefined }],
    ['blank allowed origin', { SCOUT_ALLOWED_ORIGIN: '  ' }],
    ['no client limiter', { SCOUT_CLIENT_LIMITER: undefined }],
    ['no global limiter', { SCOUT_GLOBAL_LIMITER: undefined }],
    ['limiter without limit()', { SCOUT_GLOBAL_LIMITER: {} as RateLimiter }],
    ['no CF-Connecting-IP', {}, { clientIp: null }],
    [
      'spoofable forwarding headers only',
      {},
      { clientIp: null, headers: { 'X-Forwarded-For': '198.51.100.1', 'True-Client-IP': '198.51.100.2', 'X-Real-IP': '198.51.100.3' } },
    ],
    ['malformed CF-Connecting-IP', {}, { clientIp: 'not-an-address' }],
    ['oversized CF-Connecting-IP', {}, { clientIp: '1'.repeat(60) }],
  ];
  for (const [label, overrides, requestOptions] of configs) {
    const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
    const { env, client, global } = liveEnv(overrides);
    await expectUnavailable(await runWorker(scoutRequest(requestOptions), env, provider), 503);
    assert.equal(provider.calls.length, 0, label);
    assert.equal(client.keys.length + global.keys.length, 0, label);
  }
});

test('denied or failing limit checks stop before the provider; the client limit is checked first', async () => {
  const cases: Array<[string, LimiterBehavior, LimiterBehavior, number, number]> = [
    ['client denied', 'deny', 'allow', 429, 0],
    ['global denied', 'allow', 'deny', 429, 1],
    ['client throws', 'throw', 'allow', 503, 0],
    ['global throws', 'allow', 'throw', 503, 1],
    ['client malformed answer', 'malformed', 'allow', 503, 0],
    ['global malformed answer', 'allow', 'malformed', 503, 1],
  ];
  for (const [label, clientBehavior, globalBehavior, status, globalChecks] of cases) {
    const client = fakeLimiter(clientBehavior);
    const global = fakeLimiter(globalBehavior);
    const provider = fakeProvider(() => providerJson({ results: [hit(1)] }));
    const env = liveEnv({ SCOUT_CLIENT_LIMITER: client.limiter, SCOUT_GLOBAL_LIMITER: global.limiter }).env;
    const reply = await expectUnavailable(await runWorker(scoutRequest(), env, provider), status);
    assert.equal(reply.headers.get('Retry-After'), status === 429 ? '60' : null, label);
    assert.deepEqual(client.keys, [`client:${CLIENT_IP}`], label);
    assert.equal(global.keys.length, globalChecks, label);
    assert.equal(provider.calls.length, 0, label);
  }

  // IPv6 clients share one bucket per /64 (a host can rotate within it); IPv4 is used whole.
  const keyCases: Array<[string, string]> = [
    ['2001:db8:85a3:0012:aaaa:bbbb:cccc:0001', 'client:2001:db8:85a3:12::/64'],
    ['2001:DB8:85A3:12:ffff:1:2:3', 'client:2001:db8:85a3:12::/64'],
    ['2001:db8::1', 'client:2001:db8:0:0::/64'],
    ['2001:db8:0:0:9::7', 'client:2001:db8:0:0::/64'],
    ['::1', 'client:0:0:0:0::/64'],
    ['198.51.100.23', 'client:198.51.100.23'],
    ['::ffff:198.51.100.23', 'client:::ffff:198.51.100.23'],
    ['2001:db8:::1', 'client:2001:db8:::1'],
  ];
  for (const [address, expectedKey] of keyCases) {
    const keyed = fakeLimiter();
    const env = liveEnv({ SCOUT_CLIENT_LIMITER: keyed.limiter }).env;
    await readReply(await runWorker(scoutRequest({ clientIp: address }), env, fakeProvider(() => providerJson({ results: [] }))));
    assert.deepEqual(keyed.keys, [expectedKey], address);
  }
  const sixty = countingLimiter(5);
  const v6Env = liveEnv({ SCOUT_CLIENT_LIMITER: sixty.limiter }).env;
  const v6Statuses: number[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const address = `2001:db8:85a3:12:${i.toString(16)}::${i}`;
    v6Statuses.push((await readReply(await runWorker(scoutRequest({ clientIp: address }), v6Env, fakeProvider(() => providerJson({ results: [] }))))).status);
  }
  assert.deepEqual(v6Statuses, [200, 200, 200, 200, 200, 429], 'rotating within one /64 shares a budget');

  // 5 per client and 30 overall within one period (as one location's counters would see it).
  const client = countingLimiter(5);
  const global = countingLimiter(30);
  const provider = fakeProvider(() => providerJson({ results: [] }));
  const env = liveEnv({ SCOUT_CLIENT_LIMITER: client.limiter, SCOUT_GLOBAL_LIMITER: global.limiter }).env;
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await readReply(await runWorker(scoutRequest(), env, provider))).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.equal(provider.calls.length, 5);

  const shared = countingLimiter(30);
  const many = fakeProvider(() => providerJson({ results: [] }));
  const sharedEnv = liveEnv({ SCOUT_GLOBAL_LIMITER: shared.limiter }).env;
  const overall: number[] = [];
  for (let i = 0; i < 31; i += 1) {
    overall.push((await readReply(await runWorker(scoutRequest({ clientIp: `198.51.100.${i}` }), sharedEnv, many))).status);
  }
  assert.deepEqual(overall.slice(28), [200, 200, 429]);
  assert.equal(many.calls.length, 30);
});

// ---------------------------------------------------------------------------------------------
// Pages adapter

function fakeBinding(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const binding: ServiceBinding = {
    fetch(request) {
      requests.push(request);
      return Promise.resolve().then(() => respond(request));
    },
  };
  return { binding, requests };
}

const demoBackend = () =>
  fakeBinding(() => providerJson({ mode: 'demo', city: BERLIN, query: BERLIN_PROFILE.defaultQuery, results: [] }));

const runAdapter = (request: Request, env: ScoutPagesEnv, provider?: FakeProvider) =>
  withProvider(provider, () => onRequest({ request, env }));

/** The adapter wired to the actual Worker handler, as a configured service binding would be. */
const workerBinding = (env: ScoutEnv): ServiceBinding => ({ fetch: (request) => scoutWorker.fetch(request, env) });

test('adapter rejects non-POST, cross-origin, wrong media type and oversized bodies without the backend', async () => {
  const backend = demoBackend();
  const env = { SCOUT_BACKEND: backend.binding };

  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const reply = await expectUnavailable(await runAdapter(scoutRequest({ method }), env), 405);
    assert.equal(reply.headers.get('Allow'), 'POST');
  }
  const rejected: RequestOptions[] = [
    { origin: null },
    { origin: 'https://evil.example' },
    { origin: 'https://other-project.pages.dev' },
    { site: 'cross-site' },
    { site: 'same-site' },
  ];
  for (const options of rejected) await expectUnavailable(await runAdapter(scoutRequest(options), env), 403);
  await expectUnavailable(await runAdapter(scoutRequest({ contentType: 'text/plain' }), env), 415);
  await expectUnavailable(await runAdapter(scoutRequest({ body: 'x'.repeat(MAX_REQUEST_BYTES + 1) }), env), 413);

  const chunked = trackedStream(encoder.encode('x'.repeat(1024)));
  await expectUnavailable(await runAdapter(scoutRequest({ body: chunked.stream }), env), 413);
  assert.equal(chunked.stats.cancelled, true);

  assert.equal(backend.requests.length, 0);
});

test('adapter forwards only the allowlisted headers and the exact body to SCOUT_BACKEND', async () => {
  const backend = demoBackend();
  const body = JSON.stringify({ cityId: 'berlin', customQuery: ' WG ' });
  const request = scoutRequest({
    body,
    headers: {
      'X-Forwarded-For': '198.51.100.1',
      'True-Client-IP': '198.51.100.2',
      'X-Real-IP': '198.51.100.3',
      Forwarded: 'for=198.51.100.4',
      Cookie: 'session=secret',
      Authorization: `Bearer ${FAKE_KEY}`,
      'X-Tavily-Api-Key': FAKE_KEY,
      'CF-Ray': 'abc',
    },
  });
  const reply = await readReply(await runAdapter(request, { SCOUT_BACKEND: backend.binding }));
  assert.equal(reply.body.mode, 'demo');

  assert.equal(backend.requests.length, 1);
  const [forwarded] = backend.requests;
  assert.equal(forwarded.url, 'https://scout-backend.invalid/api/scout');
  assert.equal(forwarded.method, 'POST');
  assert.deepEqual(Object.fromEntries(forwarded.headers), {
    'cf-connecting-ip': CLIENT_IP,
    'content-type': 'application/json',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  });
  assert.equal(await forwarded.text(), body);

  // Without a usable edge identity nothing identity-like is forwarded.
  const anonymous = demoBackend();
  await readReply(await runAdapter(scoutRequest({ clientIp: 'spoofed value', site: null }), { SCOUT_BACKEND: anonymous.binding }));
  assert.deepEqual(Object.fromEntries(anonymous.requests[0].headers), { 'content-type': 'application/json', origin: ORIGIN });
});

test('adapter answers explicit 503 JSON for a missing, failing or non-conforming backend', async () => {
  const backends: Array<[string, ScoutPagesEnv]> = [
    ['absent binding', {}],
    ['binding without fetch', { SCOUT_BACKEND: {} as ServiceBinding }],
    ['binding throws', { SCOUT_BACKEND: fakeBinding(() => Promise.reject(new Error(`no such service ${FAKE_KEY}`))).binding }],
    ['runtime error page', { SCOUT_BACKEND: fakeBinding(() => new Response(`<html>Error 1101 ${PROVIDER_SECRET}</html>`, { status: 500 })).binding }],
    ['unexpected status', { SCOUT_BACKEND: fakeBinding(() => providerJson({ mode: 'unavailable', error: 'x' }, 418)).binding }],
    ['non-JSON 200', { SCOUT_BACKEND: fakeBinding(() => new Response(PROVIDER_SECRET, { status: 200 })).binding }],
    ['wrong shape 200', { SCOUT_BACKEND: fakeBinding(() => providerJson({ results: [hit(1)] })).binding }],
    ['unavailable body with 200', { SCOUT_BACKEND: fakeBinding(() => providerJson({ mode: 'unavailable', error: 'x' })).binding }],
    ['live body with 502', { SCOUT_BACKEND: fakeBinding(() => providerJson({ mode: 'live', results: [] }, 502)).binding }],
    [
      'oversized backend body',
      { SCOUT_BACKEND: fakeBinding(() => new Response(trackedStream(new Uint8Array(256 * 1024).fill(0x20)).stream, { status: 200 })).binding },
    ],
  ];
  for (const [label, env] of backends) {
    const reply = await expectUnavailable(await runAdapter(scoutRequest(), env), 503);
    assert.equal(reply.body.error, 'Live search is unavailable right now.', label);
  }
});

test('adapter relays contract statuses with only its own headers', async () => {
  const backend = fakeBinding(() =>
    providerJson({ mode: 'unavailable', error: 'Too many Scout searches. Wait a minute and try again.' }, 429, {
      'Retry-After': '45',
      'Set-Cookie': 'a=b',
      'Access-Control-Allow-Origin': '*',
      'X-Internal': PROVIDER_SECRET,
    })
  );
  const reply = await expectUnavailable(await runAdapter(scoutRequest(), { SCOUT_BACKEND: backend.binding }), 429);
  assert.equal(reply.headers.get('Retry-After'), '45');
  assert.equal(reply.headers.get('X-Internal'), null);

  // A 429 always carries a numeric Retry-After, whatever the backend sent.
  for (const retryAfter of [null, '', 'soon', `60, ${PROVIDER_SECRET}`, 'Wed, 21 Oct 2026 07:28:00 GMT', '9999999']) {
    const relayed = fakeBinding(() =>
      providerJson({ mode: 'unavailable', error: 'safe' }, 429, retryAfter === null ? {} : { 'Retry-After': retryAfter })
    );
    const limited = await expectUnavailable(await runAdapter(scoutRequest(), { SCOUT_BACKEND: relayed.binding }), 429);
    assert.equal(limited.headers.get('Retry-After'), '60', String(retryAfter));
  }

  for (const status of [400, 403, 413, 415, 502, 504]) {
    const relayed = fakeBinding(() => providerJson({ mode: 'unavailable', error: 'safe' }, status));
    const relayedReply = await expectUnavailable(await runAdapter(scoutRequest(), { SCOUT_BACKEND: relayed.binding }), status);
    assert.equal(relayedReply.headers.get('Retry-After'), null, String(status));
  }
});

test('adapter passes the caller signal so a disconnect cancels the Worker provider call', async () => {
  const controller = new AbortController();
  const gate = signalWhen(pendingUntilAborted);
  const provider = fakeProvider(gate.handler);
  const env: ScoutPagesEnv = { SCOUT_BACKEND: workerBinding(liveEnv().env) };
  const reply = await withProvider(provider, async () => {
    const pending = onRequest({ request: scoutRequest({ signal: controller.signal }), env });
    await gate.ready;
    controller.abort();
    return readReply(await pending);
  });
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].init.signal.aborted, true, 'the provider request was aborted');
  // Promptly, by the caller's abort, not later by the 10-second timeout.
  assert.equal(reply.status, 502);
  assert.equal(reply.body.error, 'The Scout search was cancelled before it finished.');
});

test('adapter and Worker together: live, demo and per-client limits keyed only by the edge address', async () => {
  const client = countingLimiter(5);
  const provider = fakeProvider(() => providerJson({ answer: 'summary', results: [hit(1)] }));
  const pagesEnv: ScoutPagesEnv = { SCOUT_BACKEND: workerBinding(liveEnv({ SCOUT_CLIENT_LIMITER: client.limiter }).env) };

  const live = await readReply(await runAdapter(scoutRequest({ json: { cityId: 'berlin', customQuery: 'Wedding' } }), pagesEnv, provider));
  assert.deepEqual(live.body, {
    mode: 'live',
    city: BERLIN,
    query: 'Berlin Wedding',
    results: [{ title: 'WG-Zimmer 1', url: 'https://www.wg-gesucht.de/1.html', content: 'Zwischenmiete 1' }],
    answer: 'summary',
  });

  // Rotating spoofable forwarding headers does not create a fresh client bucket.
  const statuses: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const request = scoutRequest({ headers: { 'X-Forwarded-For': `198.51.100.${i}`, 'True-Client-IP': `198.51.100.${i}` } });
    statuses.push((await readReply(await runAdapter(request, pagesEnv, provider))).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
  assert.ok(client.keys.every((key) => key === `client:${CLIENT_IP}`));
  assert.equal(provider.calls.length, 5);

  // A different edge address has its own bucket.
  assert.equal((await readReply(await runAdapter(scoutRequest({ clientIp: '198.51.100.99' }), pagesEnv, provider))).status, 200);

  // Through the adapter, the Worker still enforces its exact configured origin.
  const otherOrigin = 'https://preview-123.rentscanner.pages.dev';
  const preview = new Request(`${otherOrigin}/api/scout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: otherOrigin, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': CLIENT_IP },
    body: JSON.stringify({ cityId: 'berlin' }),
  });
  await expectUnavailable(await runAdapter(preview, pagesEnv, provider), 403);
  assert.equal(provider.calls.length, 6);

  const demo = await readReply(await runAdapter(scoutRequest({ json: { cityId: 'paris' } }), { SCOUT_BACKEND: workerBinding({}) }, provider));
  assert.equal(demo.body.mode, 'demo');
  assert.deepEqual(demo.body.city, { id: 'paris', name: 'Paris' });
  assert.equal(provider.calls.length, 6);
});

// Node 22 prints this through console.error when the timeout tests enable mock timers.
const NODE_MOCK_TIMERS_WARNING = /^\(node:\d+\) ExperimentalWarning: The MockTimers API is an experimental feature/;

// After every test in this file (including name-filtered runs): every captured log line is
// a fixed event and carries no key, address, query or provider text.
after(() => {
  for (const line of logLines) {
    for (const secret of [FAKE_KEY, PROVIDER_SECRET, PRIVATE_QUERY, ...ADDRESS_MARKERS, 'Zwischenmiete', 'Bearer']) {
      assert.ok(!line.includes(secret), `log exposed ${secret}: ${line}`);
    }
  }
  for (const line of logLines.filter((entry) => !NODE_MOCK_TIMERS_WARNING.test(entry))) {
    const event = JSON.parse(line) as Record<string, unknown>;
    assert.equal(typeof event.scout, 'string', line);
    assert.ok(Object.keys(event).every((key) => key === 'scout' || key === 'providerStatus'), line);
  }
});

test('failure paths emit fixed log events', async () => {
  const before = logLines.length;
  const provider = fakeProvider(() => providerJson({ detail: PROVIDER_SECRET }, 500));
  await expectUnavailable(await runWorker(scoutRequest({ json: { cityId: 'berlin', customQuery: PRIVATE_QUERY } }), liveEnv().env, provider), 502);
  assert.deepEqual(logLines.slice(before), [JSON.stringify({ scout: 'provider_http_error', providerStatus: 500 })]);
});
