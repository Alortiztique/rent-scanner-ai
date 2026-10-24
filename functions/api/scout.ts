/**
 * Same-origin Pages Functions adapter for POST /api/scout.
 *
 * It forwards only a same-origin JSON POST of at most 4096 bytes to the private Scout Worker
 * through the SCOUT_BACKEND service binding. It holds no provider key, never calls the
 * provider and never substitutes sample results. A missing, failing or non-conforming backend
 * is an explicit 503. The forwarded request is rebuilt from an allowlist: the body bytes,
 * Content-Type, Origin, Sec-Fetch-Site and the edge-supplied CF-Connecting-IP. Client-supplied
 * forwarding headers (X-Forwarded-For, True-Client-IP, Forwarded, ...) and cookies are dropped.
 *
 * This file intentionally imports nothing, so the Pages bundle carries no provider code, and
 * exports only its onRequest handler (interfaces are type-only and erased).
 * Interface and setup: docs/scout-endpoint.md.
 */

/** Structural type of a Pages service binding (no runtime type dependency). */
export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface ScoutPagesEnv {
  SCOUT_BACKEND?: ServiceBinding;
}

export interface ScoutPagesContext {
  request: Request;
  env: ScoutPagesEnv;
}

const MAX_REQUEST_BYTES = 4096;
/** The Worker's own JSON answer; well above five normalized hits from a 512 KiB provider body. */
const MAX_BACKEND_RESPONSE_BYTES = 1024 * 1024;
/** Only the binding routes this request; the hostname is never resolved. */
const BACKEND_URL = 'https://scout-backend.invalid/api/scout';
/** The Worker's rate-limit period; used if a 429 arrives without a usable Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = '60';

const BACKEND_STATUSES: ReadonlySet<number> = new Set([200, 400, 403, 405, 413, 415, 429, 502, 503, 504]);

const MESSAGES = {
  method: 'Use POST for Scout searches.',
  origin: 'This request origin is not allowed.',
  mediaType: 'Send the Scout request as application/json.',
  tooLarge: 'The Scout request is too large.',
  unreadable: 'The Scout request body could not be read.',
  backend: 'Live search is unavailable right now.',
} as const;

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
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

/** Same-origin only: Origin must equal this deployment's own origin. No CORS headers are sent. */
function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site.trim().toLowerCase() !== 'same-origin') return false;
  const origin = request.headers.get('Origin');
  if (origin === null) return false;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

const CLIENT_ADDRESS_PATTERN = /^[0-9A-Fa-f:.]{3,45}$/;

type BodyRead = { kind: 'ok'; bytes: Uint8Array } | { kind: 'too_large' } | { kind: 'error' };

function cancelQuietly(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    body.cancel().catch(() => undefined);
  } catch {
    // A locked or already-consumed body cannot be cancelled here; nothing else to release.
  }
}

/** Reads at most `limit` bytes; cancels the stream as soon as it crosses the limit. */
async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  limit: number
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
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        reader.cancel().catch(() => undefined);
        return { kind: 'error' };
      }
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => undefined);
        return { kind: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'error' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

function buildBackendRequest(request: Request, bytes: Uint8Array): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const origin = request.headers.get('Origin');
  if (origin !== null) headers.set('Origin', origin);
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null) headers.set('Sec-Fetch-Site', site);
  const clientAddress = request.headers.get('CF-Connecting-IP')?.trim() ?? '';
  if (CLIENT_ADDRESS_PATTERN.test(clientAddress)) headers.set('CF-Connecting-IP', clientAddress);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Request(BACKEND_URL, { method: 'POST', headers, body, signal: request.signal });
}

function isScoutBody(status: number, value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (status === 200) return value.mode === 'live' || value.mode === 'demo';
  return value.mode === 'unavailable' && typeof value.error === 'string';
}

/**
 * Re-emits the backend's contract JSON with this adapter's own headers. Anything else
 * (runtime error pages, unexpected statuses, non-JSON, oversized bodies) becomes a 503.
 */
async function relayBackendResponse(response: Response): Promise<Response> {
  if (!BACKEND_STATUSES.has(response.status)) {
    cancelQuietly(response.body);
    return unavailable(503, MESSAGES.backend);
  }
  const body = await readBoundedBody(response.body, response.headers.get('Content-Length'), MAX_BACKEND_RESPONSE_BYTES);
  if (body.kind !== 'ok') return unavailable(503, MESSAGES.backend);

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
  } catch {
    return unavailable(503, MESSAGES.backend);
  }
  if (!isScoutBody(response.status, value)) return unavailable(503, MESSAGES.backend);

  const extraHeaders: Record<string, string> = {};
  if (response.status === 405) extraHeaders.Allow = 'POST';
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    extraHeaders['Retry-After'] =
      retryAfter !== null && /^\d{1,5}$/.test(retryAfter) ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS;
  }
  return jsonResponse(response.status, value, extraHeaders);
}

export async function onRequest(context: ScoutPagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method !== 'POST') return unavailable(405, MESSAGES.method, { Allow: 'POST' });
  if (!isSameOriginRequest(request)) return unavailable(403, MESSAGES.origin);
  if (!isJsonMediaType(request.headers.get('Content-Type'))) return unavailable(415, MESSAGES.mediaType);

  const body = await readBoundedBody(request.body, request.headers.get('Content-Length'), MAX_REQUEST_BYTES);
  if (body.kind === 'too_large') return unavailable(413, MESSAGES.tooLarge);
  if (body.kind === 'error') return unavailable(400, MESSAGES.unreadable);

  const backend = env.SCOUT_BACKEND;
  if (!backend || typeof backend.fetch !== 'function') return unavailable(503, MESSAGES.backend);

  let response: Response;
  try {
    response = await backend.fetch(buildBackendRequest(request, body.bytes));
  } catch {
    return unavailable(503, MESSAGES.backend);
  }
  try {
    return await relayBackendResponse(response);
  } catch {
    return unavailable(503, MESSAGES.backend);
  }
}
