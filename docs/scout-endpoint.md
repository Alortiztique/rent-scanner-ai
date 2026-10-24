# Scout endpoint: private Tavily search

The Live Web Scout's Tavily searches are meant to run on the server, so the Tavily key never
reaches a browser. This repository contains the server side and its offline tests. It does not
deploy or configure anything in a Cloudflare account. That is a manual owner step, described
below.

**Status:** the browser app has not been switched to this endpoint yet. Until a later frontend
change does that, the Scout shows labelled demo samples. Do not set `VITE_TAVILY_API_KEY` as a
workaround; see [Keys](#keys).

## How a request flows

```
browser ──POST /api/scout──▶ Pages Function ──SCOUT_BACKEND──▶ private Worker ──▶ api.tavily.com
(same origin)                functions/api/scout.ts   service binding   worker/scout.ts
```

- **`functions/api/scout.ts`** deploys automatically with the existing Cloudflare Pages
  project. It only handles `/api/scout`; static assets are served as before. It checks the
  method, same-origin headers, media type and size. Then it forwards a rebuilt request to the
  `SCOUT_BACKEND` binding and relays the Worker's JSON answer. It holds no key and never
  calls Tavily.
- **`worker/scout.ts`** (configured by `worker/wrangler.jsonc`) is a separate Worker. It has
  no public address: `workers_dev` and `preview_urls` are `false` and it has no routes. Only a
  service binding in the same Cloudflare account can reach it. Any such caller can set
  `Origin` and `CF-Connecting-IP` freely, so bind it only from this Pages project. The Worker
  validates the request, applies rate limits and makes the Tavily call. It reuses the app's
  `CITIES` records and the query, domain and response rules in
  `src/services/tavilySearch.ts`.
- A Pages build does **not** deploy the Worker. There is also no root Wrangler file for Pages:
  the binding is added in the dashboard, so preview builds keep working before the Worker
  exists.

## HTTP interface

Request: `POST /api/scout` with `Content-Type: application/json` and exactly this body:

```json
{"cityId":"berlin","customQuery":"optional override"}
```

- `cityId` must be one of `nyc`, `london`, `tokyo`, `bogota`, `dubai`, `paris`, `berlin`,
  `sf`. Matching is exact; names and aliases are not accepted here.
- `customQuery` is optional and at most 500 characters. It is trimmed. If it is blank or
  missing, the city's localized default query is used. A query that doesn't name the city is
  prefixed with the city name.
- Any other field is rejected, including keys, URLs, domains or search options. The server
  alone decides the provider URL, key, domains, `search_depth` and `max_results` (5).

Every response is JSON with `Cache-Control: no-store`. No CORS headers are sent.

| Status | Body | When |
|---|---|---|
| 200 | `{"mode":"live","city":{"id","name"},"query","results":[{"title","url","content"}],"answer"?}` | Tavily answered with a valid payload. `results` holds at most 5 validated hits and may be empty. Hits may carry `score` and `published_date`. `answer` is an optional, unverified provider summary. |
| 200 | `{"mode":"demo","city":{…},"query","results":[]}` | No server key is configured. Tavily is not called. The client may show its own labelled local samples; the server never invents postings. |
| 400 | `{"mode":"unavailable","error"}` | Invalid JSON, wrong shape or types, unknown city, query too long |
| 403 | same | `Origin` is not the allowed origin, or `Sec-Fetch-Site` is not `same-origin` |
| 405 | same, plus `Allow: POST` | Any method other than POST |
| 413 | same | Request body over 4096 bytes, whether declared or streamed |
| 415 | same | Not `application/json` |
| 429 | same, plus `Retry-After: 60` | Client or global rate limit reached |
| 502 | same | Provider unreachable, redirected, returned an HTTP error, a malformed or oversized body, or an all-malformed result list; also used when the caller cancels |
| 503 | same | Missing or failing binding, missing or invalid live configuration, missing client identity, limiter failure |
| 504 | same | The provider took longer than 10 seconds, including reading its body |

Error messages are fixed text. They never contain the key, the query, the client address,
provider response text or stack traces. None of the error cases fall back to demo results.

## Safety limits

- **Request:** at most 4096 bytes. A larger `Content-Length`, or a stream that goes past the
  limit, is refused and the stream is cancelled.
- **Provider:** one POST to `https://api.tavily.com/search`, authenticated with
  `Authorization: Bearer`. There is no retry, redirects are not followed, the body is
  capped at 512 KiB, and the whole operation has a 10-second timeout. If the timeout fires or
  the caller disconnects, the pending request or body read is cancelled.
- **Origin checks** protect against cross-site request forgery. They are not authentication:
  a non-browser client can send any `Origin` header. The Pages adapter requires the request's
  own origin. When `SCOUT_ALLOWED_ORIGIN` is set, the Worker also requires `Origin` to equal it
  exactly, and live mode requires it to be set. Preview deployments and second domains
  therefore can't run live searches. If the binding exists only for Production they get 503;
  if previews are bound too, they get 403.
- **Client identity:** only the edge-supplied `CF-Connecting-IP` is used. The adapter copies it
  from its own request. It drops `X-Forwarded-For`, `True-Client-IP`, `Forwarded`, cookies and
  all other headers.
- **Rate limits** use native Workers rate-limit bindings, checked in this order before any
  Tavily call:
  - `SCOUT_CLIENT_LIMITER`: 5 requests per 60 seconds per client. An IPv4 address counts on its
    own. IPv6 addresses are grouped by their /64 prefix, because one host can usually rotate
    through addresses within it.
  - `SCOUT_GLOBAL_LIMITER`: 30 requests per 60 seconds for all callers together.

  A missing binding, a failing check or a missing identity is refused with 503 before Tavily
  is called. These limits are abuse controls, **not a spending cap**:
  - Each Cloudflare location keeps its own counts. They are approximate and eventually
    consistent, so bursts can pass the threshold, and traffic across many locations adds up.
  - People behind one shared address or /64 (an office, a campus, mobile carrier NAT, a VPN)
    share one client budget.
  - `namespace_id` values belong to the whole Cloudflare account. A Worker that reuses the same
    ID shares its counters.

  To cap spending, use the provider account's own limits.
- **Query length:** the contract allows `customQuery` up to 500 characters, and the city name
  may be added in front. Tavily's guidance is to keep queries under 400 characters. A longer
  query that Tavily rejects comes back as a 502, and it has already used up rate-limit
  allowance.
- **Logs** contain only fixed event names, such as `{"scout":"provider_timeout"}`, and for
  provider HTTP errors the status code.

## Keys

- `TAVILY_API_KEY` is server-only. It exists only as a secret on the Scout Worker. Never put
  it in a `VITE_` variable, `.env`, Pages environment variables, client code or a request
  body. Vite copies every `VITE_` value into the public JavaScript bundle.
- If a real key was ever set as `VITE_TAVILY_API_KEY` in a deployed build, treat it as public:
  rotate it in the Tavily dashboard and delete the variable from Pages and any local `.env`.
- `SCOUT_ALLOWED_ORIGIN` is not a secret. It is the exact production origin, for example
  `https://<project>.pages.dev` or your custom domain, without a path or trailing slash.

## Owner setup (manual, not done by this repository)

Do this in the Cloudflare account that owns the Pages project. Wrangler is not a project
dependency, so use `npx wrangler@4`.

1. In `worker/wrangler.jsonc`, confirm that the two rate-limit `namespace_id` values
   (`2026021`, `2026022`) are not used by any other Worker in the account. Change them if
   they are.
2. Add the allowed origin. Either set `"vars": { "SCOUT_ALLOWED_ORIGIN": "https://…" }` in
   `worker/wrangler.jsonc`, or store it with
   `npx wrangler@4 secret put SCOUT_ALLOWED_ORIGIN --config worker/wrangler.jsonc`. A value set
   only in the dashboard is removed by the next `wrangler deploy` unless `keep_vars` is
   enabled.
3. Deploy the Worker: `npx wrangler@4 deploy --config worker/wrangler.jsonc`.
4. Add the key without writing it to disk:
   `npx wrangler@4 secret put TAVILY_API_KEY --config worker/wrangler.jsonc`.
5. In the Pages project, go to **Settings > Bindings > Add > Service binding**. Set the variable
   name to `SCOUT_BACKEND` and the service to `rent-scanner-scout`, for the Production
   environment. Then redeploy Pages. Without the binding, `/api/scout` returns 503.
6. Delete any `VITE_TAVILY_API_KEY` from the Pages environment variables.
7. Check the deployment. From the production site, a Scout `POST` should return `live`. A `GET`
   should return 405. The Worker should have no `workers.dev` or preview URL. Also confirm that
   the Worker sees a different `CF-Connecting-IP` for different visitors, because the offline
   tests cannot prove how the service binding passes this header. If every visitor shared one
   value, they would share one client budget.

If steps 3 or 5 are missing, `/api/scout` returns 503. With the Worker bound but no key
(step 4), it answers explicit `demo`. With a key but no `SCOUT_ALLOWED_ORIGIN` (step 2), live
searches return 503.

## Local checks (fake transports only)

```sh
npm ci
node --experimental-strip-types --test tests/tavily-search.test.ts tests/scout-endpoint.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext \
  --moduleResolution bundler --lib es2023,dom --types node --allowImportingTsExtensions \
  worker/scout.ts functions/api/scout.ts
```

The tests run the Worker's real `fetch` handler and the adapter's `onRequest`. The provider,
rate limiters and service binding are fakes, and real network access is blocked during the
tests.

To try the Worker under `wrangler dev`, leave `TAVILY_API_KEY` unset so it answers `demo`. Any
key in `worker/.dev.vars`, even a fake one, sends real requests to Tavily. `.dev.vars` files
are git-ignored. `wrangler dev` also writes local state to `worker/.wrangler/`; don't commit
it.

## Not covered yet

- Switching the browser Scout to this endpoint, removing its `VITE_TAVILY_API_KEY` read, and
  adding a public setting to choose demo or server mode. A later frontend change owns this.
- Running these tests and the Worker typecheck in CI.
- Any deployed or live-provider verification, and the relevance of real search results.
