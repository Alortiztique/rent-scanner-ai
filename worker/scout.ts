/**
 * Private Scout Worker.
 *
 * Reached only through the SCOUT_BACKEND service binding of the same-origin Pages adapter
 * (functions/api/scout.ts); worker/wrangler.jsonc disables workers.dev, preview URLs and routes.
 * It validates the frozen /api/scout request, applies the native client and global rate
 * limits, and makes at most one request to the fixed Tavily endpoint with the server-only
 * TAVILY_API_KEY. Without a key it answers explicit demo mode and calls nothing.
 *
 * City records and all query/domain/parser logic are reused from the app; this file only
 * adds the HTTP boundary. Interface and setup: docs/scout-endpoint.md.
 *
 * The default handler is the only runtime export: workerd refuses to start a Worker whose
 * main module has other named value exports. Exported interfaces are type-only and erased.
 */
import { CITIES } from '../src/data/cities.ts';
import {
  TAVILY_SEARCH_ENDPOINT,
  buildTavilySearchRequest,
  getCitySearchProfile,
  isTavilyKeyConfigured,
  parseTavilySearchResponse,
} from '../src/services/tavilySearch.ts';
import type { CitySearchProfile, TavilySearchRequestBody } from '../src/services/tavilySearch.ts';
import type { City, TavilySearchResult } from '../src/types/index.ts';

const MAX_REQUEST_BYTES = 4096;
const MAX_CUSTOM_QUERY_CHARS = 500;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;
/** Matches the 60-second period of both rate-limit bindings in worker/wrangler.jsonc. */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

/** Structural type of a Workers rate-limit binding (no runtime type dependency). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ScoutEnv {
  TAVILY_API_KEY?: string;
  SCOUT_ALLOWED_ORIGIN?: string;
  SCOUT_CLIENT_LIMITER?: RateLimiter;
  SCOUT_GLOBAL_LIMITER?: RateLimiter;
}

/** The only outbound request this Worker makes, sent with the runtime's global fetch. */
export interface ProviderRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  redirect: 'manual';
  signal: AbortSignal;
}

export interface ScoutCity {
  id: string;
  name: string;
}

export type ScoutResponseBody =
  | { mode: 'live'; city: ScoutCity; query: string; results: TavilySearchResult[]; answer?: string }
  | { mode: 'demo'; city: ScoutCity; query: string; results: [] }
  | { mode: 'unavailable'; error: string };

/** The eight existing city records that have a Scout search profile, in record order. */
const SCOUT_CITIES: readonly City[] = CITIES.filter((city) => getCitySearchProfile(city.id) !== undefined);
const SCOUT_CITY_IDS: readonly string[] = SCOUT_CITIES.map((city) => city.id);

const MESSAGES = {
  method: 'Use POST for Scout searches.',
  origin: 'This request origin is not allowed.',
  mediaType: 'Send the Scout request as application/json.',
  tooLarge: 'The Scout request is too large.',
  unreadable: 'The Scout request body could not be read.',
  invalidJson: 'The Scout request body must be valid JSON.',
  shape: 'Send only a cityId string and an optional customQuery string.',
  city: `cityId must be one of: ${SCOUT_CITY_IDS.join(', ')}.`,
  queryTooLong: `customQuery must be at most ${MAX_CUSTOM_QUERY_CHARS} characters.`,
  notConfigured: 'Live search is not configured on this server.',
  temporarilyUnavailable: 'Live search is temporarily unavailable. Try again later.',
  rateLimited: 'Too many Scout searches. Wait a minute and try again.',
  cancelled: 'The Scout search was cancelled before it finished.',
  providerUnreachable: 'The live search provider could not be reached.',
  providerFailed: 'The live search provider returned an unusable response.',
  timeout: 'The live search provider did not answer in time.',
} as const;

/** Fixed log events. Logs never include keys, queries, client addresses or provider bodies. */
type ScoutLogEvent =
  | 'invalid_origin_config'
  | 'live_config_missing'
  | 'client_identity_missing'
  | 'client_rate_limited'
  | 'global_rate_limited'
  | 'limiter_error'
  | 'caller_aborted'
  | 'provider_network_error'
  | 'provider_redirect'
  | 'provider_http_error'
  | 'provider_body_too_large'
  | 'provider_body_error'
  | 'provider_malformed'
  | 'provider_timeout';

function logScoutEvent(event: ScoutLogEvent, providerStatus?: number): void {
  console.warn(JSON.stringify(providerStatus === undefined ? { scout: event } : { scout: event, providerStatus }));
}

function jsonResponse(status: number, body: ScoutResponseBody, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function unavailable(status: number, error: string, extraHeaders?: Record<string, string>): Response {
  return jsonResponse(status, { mode: 'unavailable', error }, extraHeaders);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonMediaType(contentType: string | null): boolean {
  return contentType !== null && contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** True for a serialized http(s) origin such as "https://example.com" (no path or slash). */
function isSerializedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

type OriginConfig = { kind: 'unset' } | { kind: 'set'; value: string } | { kind: 'invalid' };

function readOriginConfig(raw: unknown): OriginConfig {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { kind: 'unset' };
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const value = raw.trim();
  return isSerializedOrigin(value) ? { kind: 'set', value } : { kind: 'invalid' };
}

/**
 * CSRF mitigation, not authentication: browsers send Origin and Sec-Fetch-Site on fetch POSTs.
 * Only same-origin (or absent) Sec-Fetch-Site and, when configured, the exact allowed origin pass.
 */
function hasAllowedOrigin(headers: Headers, allowedOrigin: string | null): boolean {
  const site = headers.get('Sec-Fetch-Site');
  if (site !== null && site.trim().toLowerCase() !== 'same-origin') return false;
  const origin = headers.get('Origin');
  if (origin === null || !isSerializedOrigin(origin)) return false;
  return allowedOrigin === null || origin === allowedOrigin;
}

const CLIENT_ADDRESS_PATTERN = /^[0-9A-Fa-f:.]{3,45}$/;

/**
 * Client identity is only the edge-supplied CF-Connecting-IP, which the Pages adapter copies
 * from its own incoming request. X-Forwarded-For, True-Client-IP and similar are ignored.
 */
function readClientIdentity(headers: Headers): string | null {
  const value = headers.get('CF-Connecting-IP')?.trim() ?? '';
  return CLIENT_ADDRESS_PATTERN.test(value) ? value : null;
}

/** First four hextets of a plain IPv6 address, without leading zeros; null if not plain IPv6. */
function ipv6Slash64(address: string): string | null {
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}

/**
 * Per-client limiter key. An IPv6 client usually controls a whole /64, so IPv6 addresses are
 * grouped by it; IPv4, IPv4-mapped and any other value are used whole.
 */
function clientLimitKey(address: string): string {
  const prefix = address.includes(':') && !address.includes('.') ? ipv6Slash64(address) : null;
  return prefix === null ? `client:${address}` : `client:${prefix}::/64`;
}

type BodyRead = { kind: 'ok'; bytes: Uint8Array } | { kind: 'too_large' } | { kind: 'error' };

function cancelQuietly(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    body.cancel().catch(() => undefined);
  } catch {
    // A locked or already-consumed body cannot be cancelled here; nothing else to release.
  }
}

/**
 * Reads at most `limit` bytes. A larger declared Content-Length is refused without reading;
 * a streamed body is cancelled as soon as it crosses the limit or the signal aborts.
 */
async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  limit: number,
  signal?: AbortSignal
): Promise<BodyRead> {
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > limit) {
      cancelQuietly(body);
      return { kind: 'too_large' };
    }
  }
  if (!body) return { kind: 'ok', bytes: new Uint8Array(0) };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    return { kind: 'error' };
  }
  const cancelReader = () => {
    reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted) {
    cancelReader();
    return { kind: 'error' };
  }
  signal?.addEventListener('abort', cancelReader, { once: true });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        cancelReader();
        return { kind: 'error' };
      }
      total += value.byteLength;
      if (total > limit) {
        cancelReader();
        return { kind: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'error' };
  } finally {
    signal?.removeEventListener('abort', cancelReader);
  }
  if (signal?.aborted) return { kind: 'error' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

type ParsedScoutRequest =
  | { ok: true; city: City; profile: CitySearchProfile; customQuery?: string }
  | { ok: false; error: string };

/** Exact contract shape: {"cityId": one of the eight ids, "customQuery"?: string <= 500 chars}. */
function parseScoutRequest(bytes: Uint8Array): ParsedScoutRequest {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes));
  } catch {
    return { ok: false, error: MESSAGES.invalidJson };
  }
  if (!isPlainObject(value)) return { ok: false, error: MESSAGES.shape };
  if (Object.keys(value).some((key) => key !== 'cityId' && key !== 'customQuery')) {
    return { ok: false, error: MESSAGES.shape };
  }

  const { cityId, customQuery } = value;
  if (typeof cityId !== 'string') return { ok: false, error: MESSAGES.shape };
  if (customQuery !== undefined && typeof customQuery !== 'string') return { ok: false, error: MESSAGES.shape };

  const city = SCOUT_CITIES.find((record) => record.id === cityId);
  const profile = city ? getCitySearchProfile(city.id) : undefined;
  if (!city || !profile) return { ok: false, error: MESSAGES.city };

  if (customQuery !== undefined && [...customQuery].length > MAX_CUSTOM_QUERY_CHARS) {
    return { ok: false, error: MESSAGES.queryTooLong };
  }
  return { ok: true, city, profile, customQuery };
}

type LimitDecision = 'allowed' | 'client_denied' | 'global_denied' | 'error';

async function consumeLimit(limiter: RateLimiter, key: string): Promise<boolean | 'error'> {
  try {
    const outcome: unknown = await limiter.limit({ key });
    if (!isPlainObject(outcome) || typeof outcome.success !== 'boolean') return 'error';
    return outcome.success;
  } catch {
    return 'error';
  }
}

/** Client limit first, so a throttled caller does not consume the shared global budget. */
async function checkRateLimits(client: RateLimiter, global: RateLimiter, clientAddress: string): Promise<LimitDecision> {
  const clientAllowed = await consumeLimit(client, clientLimitKey(clientAddress));
  if (clientAllowed === 'error') return 'error';
  if (!clientAllowed) return 'client_denied';
  const globalAllowed = await consumeLimit(global, 'global');
  if (globalAllowed === 'error') return 'error';
  return globalAllowed ? 'allowed' : 'global_denied';
}

function isRateLimiter(value: unknown): value is RateLimiter {
  return isPlainObject(value) && typeof value.limit === 'function';
}

type ProviderOutcome =
  | { kind: 'ok'; answer?: string; results: TavilySearchResult[] }
  | { kind: 'failed'; status: 502 | 504; error: string; event: ScoutLogEvent; providerStatus?: number };

function providerFailure(
  status: 502 | 504,
  error: string,
  event: ScoutLogEvent,
  providerStatus?: number
): ProviderOutcome {
  return { kind: 'failed', status, error, event, providerStatus };
}

/**
 * One request to the fixed endpoint: no retry and no redirect following. The timeout covers
 * the request, the bounded body read and validation; on timeout or caller abort the pending
 * request or body read is cancelled and the answer is returned without waiting for it.
 */
async function callProvider(
  apiKey: string,
  providerRequest: TavilySearchRequestBody,
  callerSignal: AbortSignal | undefined
): Promise<ProviderOutcome> {
  // An abort that happened while the rate limits were checked would never fire the listener.
  if (callerSignal?.aborted) return providerFailure(502, MESSAGES.cancelled, 'caller_aborted');
  const controller = new AbortController();
  let interrupt: (outcome: ProviderOutcome) => void = () => undefined;
  const interrupted = new Promise<ProviderOutcome>((resolve) => {
    interrupt = resolve;
  });
  const timer = setTimeout(() => {
    interrupt(providerFailure(504, MESSAGES.timeout, 'provider_timeout'));
    controller.abort();
  }, PROVIDER_TIMEOUT_MS);
  const onCallerAbort = () => {
    interrupt(providerFailure(502, MESSAGES.cancelled, 'caller_aborted'));
    controller.abort();
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  const attempt = (async (): Promise<ProviderOutcome> => {
    const init: ProviderRequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(providerRequest),
      redirect: 'manual',
      signal: controller.signal,
    };
    let response: Response;
    try {
      response = await fetch(TAVILY_SEARCH_ENDPOINT, init);
    } catch {
      return providerFailure(502, MESSAGES.providerUnreachable, 'provider_network_error');
    }

    if (response.status < 200 || response.status > 299) {
      cancelQuietly(response.body);
      const isRedirect = response.status >= 300 && response.status < 400;
      return providerFailure(
        502,
        MESSAGES.providerFailed,
        isRedirect ? 'provider_redirect' : 'provider_http_error',
        response.status
      );
    }

    const body = await readBoundedBody(
      response.body,
      response.headers.get('Content-Length'),
      MAX_PROVIDER_BODY_BYTES,
      controller.signal
    );
    if (body.kind === 'too_large') return providerFailure(502, MESSAGES.providerFailed, 'provider_body_too_large');
    if (body.kind === 'error') return providerFailure(502, MESSAGES.providerFailed, 'provider_body_error');

    let payload: unknown;
    try {
      payload = JSON.parse(decodeUtf8(body.bytes));
    } catch {
      return providerFailure(502, MESSAGES.providerFailed, 'provider_malformed');
    }
    const parsed = parseTavilySearchResponse(payload);
    if (!parsed.ok) return providerFailure(502, MESSAGES.providerFailed, 'provider_malformed');
    return { kind: 'ok', answer: parsed.answer, results: parsed.results };
  })().catch(() => providerFailure(502, MESSAGES.providerFailed, 'provider_body_error'));

  try {
    return await Promise.race([attempt, interrupted]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

async function handleScoutRequest(request: Request, env: ScoutEnv): Promise<Response> {
  if (request.method !== 'POST') return unavailable(405, MESSAGES.method, { Allow: 'POST' });

  const originConfig = readOriginConfig(env.SCOUT_ALLOWED_ORIGIN);
  if (originConfig.kind === 'invalid') {
    logScoutEvent('invalid_origin_config');
    return unavailable(503, MESSAGES.notConfigured);
  }
  const allowedOrigin = originConfig.kind === 'set' ? originConfig.value : null;
  if (!hasAllowedOrigin(request.headers, allowedOrigin)) return unavailable(403, MESSAGES.origin);

  if (!isJsonMediaType(request.headers.get('Content-Type'))) return unavailable(415, MESSAGES.mediaType);

  const body = await readBoundedBody(request.body, request.headers.get('Content-Length'), MAX_REQUEST_BYTES);
  if (body.kind === 'too_large') return unavailable(413, MESSAGES.tooLarge);
  if (body.kind === 'error') return unavailable(400, MESSAGES.unreadable);

  const parsed = parseScoutRequest(body.bytes);
  if (!parsed.ok) return unavailable(400, parsed.error);

  const providerRequest = buildTavilySearchRequest(parsed.city, parsed.profile, parsed.customQuery);
  const city: ScoutCity = { id: parsed.city.id, name: parsed.city.name };

  const apiKey = typeof env.TAVILY_API_KEY === 'string' ? env.TAVILY_API_KEY.trim() : '';
  if (!isTavilyKeyConfigured(apiKey)) {
    return jsonResponse(200, { mode: 'demo', city, query: providerRequest.query, results: [] });
  }

  const clientLimiter = env.SCOUT_CLIENT_LIMITER;
  const globalLimiter = env.SCOUT_GLOBAL_LIMITER;
  if (allowedOrigin === null || !isRateLimiter(clientLimiter) || !isRateLimiter(globalLimiter)) {
    logScoutEvent('live_config_missing');
    return unavailable(503, MESSAGES.notConfigured);
  }
  const clientAddress = readClientIdentity(request.headers);
  if (clientAddress === null) {
    logScoutEvent('client_identity_missing');
    return unavailable(503, MESSAGES.temporarilyUnavailable);
  }

  if (request.signal?.aborted) {
    logScoutEvent('caller_aborted');
    return unavailable(502, MESSAGES.cancelled);
  }

  const decision = await checkRateLimits(clientLimiter, globalLimiter, clientAddress);
  if (decision === 'error') {
    logScoutEvent('limiter_error');
    return unavailable(503, MESSAGES.temporarilyUnavailable);
  }
  if (decision !== 'allowed') {
    logScoutEvent(decision === 'client_denied' ? 'client_rate_limited' : 'global_rate_limited');
    return unavailable(429, MESSAGES.rateLimited, { 'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS) });
  }

  const outcome = await callProvider(apiKey, providerRequest, request.signal);
  if (outcome.kind === 'failed') {
    logScoutEvent(outcome.event, outcome.providerStatus);
    return unavailable(outcome.status, outcome.error);
  }

  return jsonResponse(200, {
    mode: 'live',
    city,
    query: providerRequest.query,
    results: outcome.results,
    ...(outcome.answer === undefined ? {} : { answer: outcome.answer }),
  });
}

export default {
  fetch(request: Request, env: ScoutEnv): Promise<Response> {
    return handleScoutRequest(request, env);
  },
};
