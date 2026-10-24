/**
 * Pure browser transport for the Scout: chooses local demo or the same-origin /api/scout
 * server, validates the server's answer against the request, and maps it through the
 * truthful candidate module. It never reads a provider key and never calls the provider.
 *
 * Inputs are injected (mode setting, city records, fetch, signal) and runtime imports use
 * explicit .ts paths, so `node --experimental-strip-types` can run it with fake transports.
 * Server contract: docs/scout-endpoint.md.
 */
import type { TavilySearchResult } from '../types';
import {
  buildScoutQuery,
  describeUnsupportedCity,
  parseTavilySearchResponse,
  resolveSearchCity,
} from './tavilySearch.ts';
import type { CityIdentity, CitySearchProfile } from './tavilySearch.ts';
import { toTavilyScoutResult } from './scoutListings.ts';
import type { TavilyScoutResult } from './scoutListings.ts';

/** The only address the browser Scout calls: this site's own Pages Function. */
export const SCOUT_ENDPOINT_PATH = '/api/scout';
/** Longer than the server's 10-second provider deadline; covers reading the response body. */
export const SCOUT_CLIENT_TIMEOUT_MS = 12_000;
/** Same cap as the Pages adapter's relay of the Worker answer. */
export const MAX_SCOUT_RESPONSE_BYTES = 1024 * 1024;
/** The server's customQuery limit, in Unicode characters. */
export const MAX_CUSTOM_QUERY_CHARS = 500;

export type ScoutMode = 'demo' | 'server';
export type ScoutModeSetting = { ok: true; mode: ScoutMode } | { ok: false };

/**
 * Reads the public VITE_SCOUT_MODE value. Absent or blank means local demo; "demo" and "server"
 * are accepted exactly (surrounding whitespace ignored). Anything else is invalid, and the
 * Scout then reports unavailable instead of picking a mode on its own.
 */
export function readScoutMode(raw: unknown): ScoutModeSetting {
  if (raw === undefined || raw === null) return { ok: true, mode: 'demo' };
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (value === '' || value === 'demo') return { ok: true, mode: 'demo' };
  if (value === 'server') return { ok: true, mode: 'server' };
  return { ok: false };
}

export interface ScoutClientRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  credentials: 'omit';
  cache: 'no-store';
  redirect: 'error';
  mode: 'same-origin';
  signal: AbortSignal;
}

/** Shape of the browser fetch used here; tests inject a fake that returns real Responses. */
export type ScoutClientFetch = (url: string, init: ScoutClientRequestInit) => Promise<Response>;

/** Fixed diagnostic codes. Callers may log these; they never contain query or response text. */
export type ScoutClientEvent =
  | 'local_demo'
  | 'server_demo'
  | 'live'
  | 'invalid_mode'
  | 'unsupported_city'
  | 'query_too_long'
  | 'network_error'
  | 'server_error_status'
  | 'unexpected_status'
  | 'not_json'
  | 'body_too_large'
  | 'body_error'
  | 'malformed_envelope'
  | 'city_mismatch'
  | 'query_mismatch'
  | 'malformed_results'
  | 'timeout'
  | 'cancelled';

export interface ScoutClientOutcome {
  result: TavilyScoutResult;
  event: ScoutClientEvent;
  /** HTTP status of the server answer, when one arrived. */
  status?: number;
}

export interface ScoutClientOptions {
  city: string;
  customQuery?: string;
  /** Raw VITE_SCOUT_MODE value. */
  mode: unknown;
  cities: readonly CityIdentity[];
  fetchImpl: ScoutClientFetch;
  signal?: AbortSignal;
  /** Overrides SCOUT_CLIENT_TIMEOUT_MS. */
  timeoutMs?: number;
}

const MESSAGES = {
  invalidMode: 'Scout is misconfigured: VITE_SCOUT_MODE must be "demo" or "server". No search ran.',
  queryTooLong: `The custom query must be at most ${MAX_CUSTOM_QUERY_CHARS} characters. No search ran.`,
  network: 'The Scout server could not be reached.',
  unexpected: 'The Scout server returned an unexpected response.',
  inconsistent: 'The Scout server answered for a different search, so its answer was discarded.',
  timeout: 'The Scout server did not answer in time.',
  cancelled: 'The search was cancelled before it finished.',
  rejected: 'The Scout server rejected this search request.',
  origin: 'This site is not allowed to use the Scout server.',
  rateLimited: 'Too many Scout searches right now. Wait a minute and try again.',
  providerFailed: 'The live search provider could not complete this search.',
  notConfigured: 'Live search is not available on this server right now.',
  providerTimeout: 'The live search provider did not answer in time.',
} as const;

/** Contract error statuses with a fixed client message. Server error text is not shown. */
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: MESSAGES.rejected,
  403: MESSAGES.origin,
  405: MESSAGES.rejected,
  413: MESSAGES.rejected,
  415: MESSAGES.rejected,
  429: MESSAGES.rateLimited,
  502: MESSAGES.providerFailed,
  503: MESSAGES.notConfigured,
  504: MESSAGES.providerTimeout,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isJsonMediaType(contentType: string | null): boolean {
  return contentType !== null && contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

function unavailable(event: ScoutClientEvent, error: string, status?: number): ScoutClientOutcome {
  return { result: { listings: [], mode: 'unavailable', error }, event, status };
}

function cancelled(): ScoutClientOutcome {
  return { result: { listings: [], mode: 'cancelled', error: MESSAGES.cancelled }, event: 'cancelled' };
}

type BodyRead = { kind: 'ok'; text: string } | { kind: 'too_large' } | { kind: 'error' };

function cancelQuietly(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    body.cancel().catch(() => undefined);
  } catch {
    // A locked or consumed body cannot be cancelled here; nothing else to release.
  }
}

/** Reads at most `limit` bytes of UTF-8 text; cancels the stream on overflow or abort. */
async function readBoundedText(response: Response, limit: number, signal: AbortSignal): Promise<BodyRead> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > limit) {
    cancelQuietly(response.body);
    return { kind: 'too_large' };
  }
  if (!response.body) return { kind: 'ok', text: '' };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return { kind: 'error' };
  }
  const cancelReader = () => {
    reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    cancelReader();
    return { kind: 'error' };
  }
  signal.addEventListener('abort', cancelReader, { once: true });

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
    signal.removeEventListener('abort', cancelReader);
  }
  if (signal.aborted) return { kind: 'error' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: 'ok', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'error' };
  }
}

type Envelope =
  | { kind: 'live'; answer?: string; results: TavilySearchResult[] }
  | { kind: 'demo' }
  | { kind: 'invalid'; event: 'malformed_envelope' | 'city_mismatch' | 'query_mismatch' | 'malformed_results' };

/**
 * Checks a 200 answer against the frozen contract and against this request: the same city
 * record and the same effective query. Live hits go through the shared hit validation.
 */
function readSuccessEnvelope(value: unknown, city: CityIdentity, query: string): Envelope {
  const malformed = { kind: 'invalid', event: 'malformed_envelope' } as const;
  if (!isPlainObject(value)) return malformed;
  const { mode } = value;
  if (mode === 'live') {
    if (!hasOnlyKeys(value, ['mode', 'city', 'query', 'results', 'answer'])) return malformed;
  } else if (mode === 'demo') {
    if (!hasOnlyKeys(value, ['mode', 'city', 'query', 'results'])) return malformed;
  } else {
    return malformed;
  }

  const answerCity = value.city;
  if (
    !isPlainObject(answerCity) ||
    !hasOnlyKeys(answerCity, ['id', 'name']) ||
    typeof answerCity.id !== 'string' ||
    typeof answerCity.name !== 'string'
  ) {
    return malformed;
  }
  if (typeof value.query !== 'string' || !Array.isArray(value.results)) return malformed;
  if (answerCity.id !== city.id || answerCity.name !== city.name) return { kind: 'invalid', event: 'city_mismatch' };
  if (value.query !== query) return { kind: 'invalid', event: 'query_mismatch' };

  if (mode === 'demo') return value.results.length === 0 ? { kind: 'demo' } : malformed;

  if (value.answer !== undefined && typeof value.answer !== 'string') return malformed;
  const parsed = parseTavilySearchResponse({ results: value.results, answer: value.answer });
  if (!parsed.ok) return { kind: 'invalid', event: 'malformed_results' };
  return { kind: 'live', answer: parsed.answer, results: parsed.results };
}

function isUnavailableBody(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasOnlyKeys(value, ['mode', 'error']) &&
    value.mode === 'unavailable' &&
    typeof value.error === 'string'
  );
}

function rateLimitMessage(response: Response): string {
  const retryAfter = response.headers.get('Retry-After');
  return retryAfter !== null && /^\d{1,5}$/.test(retryAfter.trim())
    ? `Too many Scout searches right now. Try again in ${Number(retryAfter.trim())} seconds.`
    : MESSAGES.rateLimited;
}

async function interpretResponse(
  response: Response,
  signal: AbortSignal,
  city: CityIdentity,
  profile: CitySearchProfile,
  query: string
): Promise<ScoutClientOutcome> {
  const status = response.status;
  const isSuccess = status === 200;
  if (!isSuccess && STATUS_MESSAGES[status] === undefined) {
    cancelQuietly(response.body);
    return unavailable('unexpected_status', MESSAGES.unexpected, status);
  }
  // A missing Function or binding can be answered by the static site (HTML), never JSON.
  if (!isJsonMediaType(response.headers.get('Content-Type'))) {
    cancelQuietly(response.body);
    return unavailable('not_json', MESSAGES.unexpected, status);
  }

  const body = await readBoundedText(response, MAX_SCOUT_RESPONSE_BYTES, signal);
  if (body.kind === 'too_large') return unavailable('body_too_large', MESSAGES.unexpected, status);
  if (body.kind === 'error') return unavailable('body_error', MESSAGES.unexpected, status);

  let value: unknown;
  try {
    value = JSON.parse(body.text);
  } catch {
    return unavailable('not_json', MESSAGES.unexpected, status);
  }

  if (!isSuccess) {
    if (!isUnavailableBody(value)) return unavailable('malformed_envelope', MESSAGES.unexpected, status);
    const message = status === 429 ? rateLimitMessage(response) : STATUS_MESSAGES[status];
    return unavailable('server_error_status', message, status);
  }

  const envelope = readSuccessEnvelope(value, city, query);
  if (envelope.kind === 'invalid') {
    const message =
      envelope.event === 'city_mismatch' || envelope.event === 'query_mismatch' ? MESSAGES.inconsistent : MESSAGES.unexpected;
    return unavailable(envelope.event, message, status);
  }
  if (envelope.kind === 'demo') {
    const result = toTavilyScoutResult({ kind: 'demo', city, profile, query });
    return { result: { ...result, demoSource: 'server' }, event: 'server_demo', status };
  }
  const result = toTavilyScoutResult({ kind: 'live', city, query, answer: envelope.answer, results: envelope.results });
  return { result, event: 'live', status };
}

/**
 * Runs one Scout search. Local demo makes no network call. Server mode sends exactly
 * {"cityId", "customQuery"?} to SCOUT_ENDPOINT_PATH and accepts only a conforming answer for
 * that city and query. Every failure is unavailable (or cancelled); none becomes demo or live.
 */
export async function runScoutClientSearch(options: ScoutClientOptions): Promise<ScoutClientOutcome> {
  const setting = readScoutMode(options.mode);
  if (!setting.ok) return unavailable('invalid_mode', MESSAGES.invalidMode);

  const resolution = resolveSearchCity(options.city, options.cities);
  if (resolution.status === 'unsupported') {
    const result = toTavilyScoutResult({ kind: 'unsupported', error: describeUnsupportedCity(resolution, options.cities) });
    return { result, event: 'unsupported_city' };
  }
  const { profile } = resolution;
  const city: CityIdentity = { id: resolution.city.id, name: resolution.city.name };
  const customQuery = typeof options.customQuery === 'string' ? options.customQuery.trim() : '';
  if ([...customQuery].length > MAX_CUSTOM_QUERY_CHARS) return unavailable('query_too_long', MESSAGES.queryTooLong);
  const query = buildScoutQuery(city, profile, customQuery);

  if (setting.mode === 'demo') {
    const result = toTavilyScoutResult({ kind: 'demo', city, profile, query });
    return { result: { ...result, demoSource: 'local' }, event: 'local_demo' };
  }

  const callerSignal = options.signal;
  if (callerSignal?.aborted) return cancelled();

  const controller = new AbortController();
  let interrupt: (outcome: ScoutClientOutcome) => void = () => undefined;
  const interrupted = new Promise<ScoutClientOutcome>((resolve) => {
    interrupt = resolve;
  });
  const timer = setTimeout(() => {
    interrupt(unavailable('timeout', MESSAGES.timeout));
    controller.abort();
  }, options.timeoutMs ?? SCOUT_CLIENT_TIMEOUT_MS);
  const onCallerAbort = () => {
    interrupt(cancelled());
    controller.abort();
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  const requestBody = customQuery ? { cityId: city.id, customQuery } : { cityId: city.id };
  const attempt = (async (): Promise<ScoutClientOutcome> => {
    let response: Response;
    try {
      response = await options.fetchImpl(SCOUT_ENDPOINT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        mode: 'same-origin',
        signal: controller.signal,
      });
    } catch {
      return unavailable('network_error', MESSAGES.network);
    }
    return interpretResponse(response, controller.signal, city, profile, query);
  })().catch(() => unavailable('body_error', MESSAGES.unexpected));

  try {
    return await Promise.race([attempt, interrupted]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}
