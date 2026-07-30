# API (apps/backend)

Base URL: `http://localhost:4000`

All application routes are versioned under `/api/v1`. `/health`, `/ready`, and `/metrics` are unversioned — infra probes and scrapers shouldn't need to track API version.

## Authentication

Every `/api/v1/*` route requires an API key via the `X-API-Key` header. `/health`, `/ready`, `/metrics`, and `/api-docs` do not require one.

```bash
curl http://localhost:4000/api/v1/creators -H "X-API-Key: <your key>"
```

Missing or invalid keys get `401` (`{error:{code:"unauthorized", ...}}`). Keys are configured via `API_KEYS` (comma-separated, see `.env.example`) — comparison is timing-safe (`apps/backend/src/middleware/apiKeyAuth.ts`), and the raw key is never logged (a short hash prefix identifies the caller in logs/metrics instead).

**Rotation**: add the new key to `API_KEYS` alongside the old one and deploy; both authenticate during the overlap window. Once every caller has switched, remove the old key and deploy again. No downtime, no coordinated cutover required.

## Correlation IDs

Every request gets an `x-request-id` (accepted from the incoming request if present, otherwise generated). It's echoed back in the response header, included in every structured log line for that request, and forwarded to each downstream Python service call so one request can be traced end-to-end across all four processes.

## Interactive docs

The OpenAPI spec (`apps/backend/openapi.yaml`) is served as interactive Swagger UI at unversioned `GET /api-docs` — no auth, read-only.

## Standard error format

Every non-2xx JSON response (validation errors, rate limiting, downstream failures, 404s, uncaught errors) uses the same envelope:

```json
{
  "error": {
    "code": "invalid_body",
    "message": "invalid body",
    "details": [ /* present for validation errors: zod issue list */ ],
    "requestId": "..."
  }
}
```

`code` is a stable machine-readable string (`invalid_body`, `invalid_query`, `idempotency_in_progress`, `service_unavailable`, `bad_gateway`, `rate_limited`, `not_found`, `internal_error`) — safe to branch on in client code instead of parsing `message`.

## `POST /api/v1/ingest/run`

Runs the search -> extract -> validate -> store pipeline for a niche/platform.

**Body** (validated with zod)
```json
{ "niche": "couple vlog", "platform": "instagram" }
```
- `niche`: string, 1-200 chars
- `platform`: one of `instagram`, `youtube`, `tiktok`

**Headers**
- `Idempotency-Key` (optional): if supplied, a repeated request with the same key within `IDEMPOTENCY_TTL_SECONDS` (default 24h) returns the original response without re-running the pipeline. A second request with the same key while the first is still in flight gets `409`.

**Response `200`**
```json
{
  "requested": 12,
  "extracted": 9,
  "validated": 6,
  "stored": 4,
  "skippedDuplicates": 2
}
```

**Errors**: `400` invalid body, `401` missing/invalid API key, `409` duplicate in-flight idempotency key, `502` a Python service failed, `503` a Python service's circuit breaker is open (fails fast instead of hanging/retrying further), `429` rate limit exceeded (`INGEST_RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`, per API key, stricter than the general limit).

**Caching**: search results are cached per `{platform, niche}` for `CACHE_TTL` seconds; validation results are cached per email for `VALIDATION_TTL` seconds. Repeated runs for the same niche, or emails already validated in a prior run, skip the Python service call entirely.

## `GET /api/v1/creators`

Paginated list of stored creators.

**Query params** (validated with zod): `page` (default 1), `pageSize` (default 20, clamped to max 100 — not rejected), `niche`, `platform` (one of `instagram`/`youtube`/`tiktok` if provided)

**Response `200`**
```json
{
  "page": 1,
  "pageSize": 20,
  "total": 4,
  "items": [
    {
      "id": "...",
      "handle": "@example",
      "platform": "instagram",
      "niche": "couple vlog",
      "email": "contact@example.com",
      "confidenceScore": 0.92
    }
  ]
}
```

**Errors**: `400` invalid query (e.g. unsupported `platform`, non-numeric `page`), `401` missing/invalid API key.

## `GET /health`

Liveness only — process is up. Always fast, no dependency checks.

## `GET /ready`

Readiness — checks Postgres (`SELECT 1`), Redis (`PING`), and each Python service's own `/health`. Returns `200` with per-dependency status if all pass, `503` otherwise.

```json
{
  "status": "ready",
  "checks": [
    { "name": "postgres", "ok": true },
    { "name": "redis", "ok": true },
    { "name": "search", "ok": true },
    { "name": "extractor", "ok": true },
    { "name": "validator", "ok": true }
  ]
}
```

## `GET /metrics`

Prometheus exposition format. Tracks: `http_request_duration_seconds` (by method/route/status), `ingest_stage_total` (by pipeline stage), `circuit_breaker_state` (per downstream service), `cache_result_total` (hit/miss per cache), plus Node process defaults.

## Rate limiting

Two layers, both Redis-backed fixed windows (shared across backend instances):

1. **Per-IP**, applied before auth so it also bounds unauthenticated/brute-force traffic: `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` (default 120/min).
2. **Per-API-key**, applied after auth: `API_KEY_RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` (default 300/min) — each credentialed caller gets its own quota independent of how many keys share an IP (NAT, shared egress). `POST /api/v1/ingest/run` additionally has its own stricter per-key limiter (`INGEST_RATE_LIMIT_MAX`, default 10/min) since it's the expensive pipeline entry point.

Standard `RateLimit-*` headers are returned on every response. If Redis itself is unreachable both limiters fail open (see `docs/SECURITY.md`) and log/increment `redis_operation_failures_total{component="rate_limit"}` rather than silently under-enforcing.

## CORS and security headers

`helmet()` sets standard security headers (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`, etc.) on every response. Cross-origin browser requests are denied by default — API key auth alone doesn't make arbitrary origins safe (a browser caller would need to expose its key client-side). Set `CORS_ALLOWED_ORIGINS` (comma-separated) to allow specific, trusted origins once a real frontend exists.

## Internal Python services (not public-facing, called only by `apps/backend`)

- `POST http://localhost:8001/search` — `{platform, niche}` -> `{urls: string[]}` (platform restricted to `instagram`/`youtube`/`tiktok`, niche 1-200 chars, enforced by Pydantic)
- `POST http://localhost:8002/extract` — `{url}` -> `{email, social_links, bio, source_url}` (`url` must be a well-formed HTTP(S) URL)
- `POST http://localhost:8003/validate` — `{email}` -> `{is_valid, confidence_score, reasons}` (`email` 3-320 chars)
- Each accepts/echoes `x-request-id` and exposes `GET /health`

Not yet implemented: campaigns, email-sending endpoints, AI endpoints, per-tenant/multi-user auth (API keys today are flat/global, not tied to an account or scoped to specific permissions).
