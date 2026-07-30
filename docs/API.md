# API (apps/backend)

Base URL: `http://localhost:4000`

All application routes are versioned under `/api/v1`. `/health`, `/ready`, and `/metrics` are unversioned — infra probes and scrapers shouldn't need to track API version.

## Correlation IDs

Every request gets an `x-request-id` (accepted from the incoming request if present, otherwise generated). It's echoed back in the response header, included in every structured log line for that request, and forwarded to each downstream Python service call so one request can be traced end-to-end across all four processes.

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

**Errors**: `400` invalid body, `409` duplicate in-flight idempotency key, `502` a Python service failed, `503` a Python service's circuit breaker is open (fails fast instead of hanging/retrying further), `429` rate limit exceeded (`INGEST_RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`, stricter than the general API limit).

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

**Errors**: `400` invalid query (e.g. unsupported `platform`, non-numeric `page`).

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

All `/api/v1/*` routes share a general limiter (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`, default 120/min, Redis-backed fixed window so limits are shared across backend instances). `POST /api/v1/ingest/run` additionally has its own stricter limiter (`INGEST_RATE_LIMIT_MAX`, default 10/min) since it's the expensive pipeline entry point. Standard `RateLimit-*` headers are returned on every response.

## Internal Python services (not public-facing, called only by `apps/backend`)

- `POST http://localhost:8001/search` — `{platform, niche}` -> `{urls: string[]}` (platform restricted to `instagram`/`youtube`/`tiktok`, niche 1-200 chars, enforced by Pydantic)
- `POST http://localhost:8002/extract` — `{url}` -> `{email, social_links, bio, source_url}` (`url` must be a well-formed HTTP(S) URL)
- `POST http://localhost:8003/validate` — `{email}` -> `{is_valid, confidence_score, reasons}` (`email` 3-320 chars)
- Each accepts/echoes `x-request-id` and exposes `GET /health`

Not yet implemented: auth on any endpoint, campaigns, email-sending endpoints, AI endpoints.
