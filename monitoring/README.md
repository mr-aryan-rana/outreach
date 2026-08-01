# Monitoring

Config artifacts for observing all four deployed services (`apps/backend`/`apps/ai`/`apps/email` expose Prometheus metrics; `apps/admin` doesn't, see below). Nothing here runs itself — these are inputs to infrastructure you provision (Prometheus, Grafana, Alertmanager, an uptime checker).

## Files

- `prometheus-alerts.yml` — alert rules for all three metrics-exposing services, in three rule groups (`makeable-backend.rules`, `makeable-ai.rules`, `makeable-email.rules`). Add to your Prometheus config's `rule_files:`. Assumes scrape jobs named `makeable-backend`/`makeable-ai`/`makeable-email` targeting each service's `GET /metrics`; rename the `job="..."` selectors throughout if yours differ.
- `alertmanager.yml` (Sprint 6) — routes alerts fired by the rules above: `critical` severity pages immediately with a 1h repeat, `warning` severity uses the default 4h repeat. **Placeholder webhook URLs** — fill in a real Slack/PagerDuty/email destination before relying on this; unconfigured, alerts are visible in Prometheus/Alertmanager's own UI but notify no one.
- `grafana-dashboard.json` — importable Grafana dashboard for `apps/backend` (Dashboards -> Import -> paste JSON, or `grafana-cli`/provisioning). Uses a `DS_PROMETHEUS` datasource variable — map it to your Prometheus datasource on import. **Not yet extended to apps/ai/apps/email** (Sprint 6 known gap) — the metrics reference below documents what's available to build ai/email panels from; use the existing backend dashboard's panels as a template (same `http_request_duration_seconds`/`circuit_breaker_state`/`redis_operation_failures_total` shape, different `job=` label and service-specific metrics layered in).

## Metrics reference

All exposed at unversioned `GET /metrics` (Prometheus text format, no auth):

### Shared across apps/backend, apps/ai, apps/email

| Metric | Type | What it tells you |
|---|---|---|
| `http_request_duration_seconds{method,route,status}` | histogram | Request latency + implicitly request rate/error rate (via `_count`) |
| `circuit_breaker_state{service\|provider}` | gauge | 0=closed, 1=half-open, 2=open, per downstream dependency |
| `redis_operation_failures_total{component}` | counter | Redis ops that failed and fell back to fail-open behavior |
| `db_query_duration_seconds{model,operation}` | histogram | Prisma query timing per model+operation — feeds slow-query alerting |
| `process_resident_memory_bytes`, `process_cpu_seconds_total`, `nodejs_*` | various | Default Node process metrics (`prom-client`'s `collectDefaultMetrics`) |

### apps/backend only

| Metric | Type | What it tells you |
|---|---|---|
| `ingest_stage_total{stage}` | counter | Pipeline funnel: `requested`/`extracted`/`validated`/`stored`/`skipped_duplicate` |
| `cache_result_total{cache,result}` | counter | Hit/miss for search-result and validation caches |

### apps/ai only

| Metric | Type | What it tells you |
|---|---|---|
| `ai_generation_duration_seconds{provider,stage,outcome}` | histogram | Per-LLM-call latency, by pipeline stage and success/failure |
| `ai_tokens_total{provider,stage,type}` | counter | Token consumption (`type`: prompt/completion) — real usage, cross-check against `GET /api/v1/ai/usage`'s DB-backed aggregate |
| `ai_estimated_cost_usd_total{provider,stage}` | counter | Estimated real spend — feeds `MakeAbleAiCostSpike` |
| `ai_provider_failures_total{provider,error}` | counter | Per-provider failure count by error type |
| `ai_fallback_used_total{primary,fallback,stage}` | counter | How often the fallback provider had to be used — feeds `MakeAbleAiHighFallbackRate` |

`GET /api/v1/ai/providers/health` and `GET /api/v1/ai/usage` (Sprint 6, `docs/API.md`) give a request-time equivalent of `circuit_breaker_state`/cost metrics without needing a Prometheus query — used by `apps/admin`'s Settings page.

### apps/email only

| Metric | Type | What it tells you |
|---|---|---|
| `email_send_duration_seconds{provider,outcome}` | histogram | Per-send latency, by provider and success/failure |
| `email_events_total{eventType}` | counter | Delivery funnel: queued/sent/delivered/deferred/bounced/opened/clicked/replied/failed |
| `email_provider_failures_total{provider,error}` | counter | Per-provider send failure count — feeds `MakeAbleEmailProviderFailureSpike` |
| `email_suppressed_total` | counter | Recipients skipped because they were on the suppression list |
| `email_duplicate_skipped_total` | counter | Recipients de-duplicated within a single campaign creation request |
| `email_queue_jobs_total{status}` | counter | BullMQ job outcomes: `completed`/`failed`/`dead_letter` — feeds `MakeAbleEmailDeadLetterGrowth`. **Not a live queue-depth gauge** (see "Known gap" below) — for current backlog, poll `GET /api/v1/dashboard/queue` instead. |

### apps/admin

No `GET /metrics` endpoint — a deliberate choice, not an oversight. Every mutating action already writes a durable `audit_log` row (`docs/API.md` "Auth, roles, and audit log") with actor/action/status/timestamp, which is a better fit for "who did what" accountability than an ephemeral Prometheus counter would be. If operational metrics (request latency, error rate) become useful later, add `prom-client` the same way the other three services do — nothing about the current architecture blocks it, it just wasn't needed for Sprint 6's scope.

## Known gap: queue depth

There is no Prometheus gauge for "how many jobs are currently waiting/active/delayed in the BullMQ queue right now" — `email_queue_jobs_total` only increments on job *completion* (success, failure, or dead-letter), not on enqueue, so it can't tell you the current backlog size. For live queue depth: poll `GET /api/v1/dashboard/queue` (`docs/API.md`) directly, or add a custom Prometheus gauge that periodically calls BullMQ's `getWaitingCount()`/`getActiveCount()`/`getDelayedCount()` (same calls `dashboard/queue` already makes) on a timer and sets gauge values from them — not implemented in this slice.

## Uptime monitoring

Not run from inside this repo — needs an external prober (something outside the deployment that can tell the difference between "the app is down" and "the prober itself is down"). Two options, either works, for each of the three metrics-exposing services (and `apps/admin`, which has `/health`/`/ready` via Next.js's own process liveness even without Prometheus metrics — a plain HTTP 200 on `GET /login` or similar is the equivalent check):

1. **Third-party synthetic monitoring** (UptimeRobot, Better Uptime, Pingdom, etc.): point it at `GET /health` (liveness — fast, no dependency checks; good for "is the process up") and separately at `GET /ready` (readiness — good for "is the whole system actually functional", since each service's `/ready` checks its own Postgres schema, Redis, and its own downstream dependencies). Alert on `/health` failing (process down) as higher severity than `/ready` failing (a dependency is degraded but the process itself is fine).
2. **Prometheus blackbox_exporter**: probe both endpoints per service, feed `probe_http_status_code`/`probe_success` into Prometheus, alert via `MakeAbleReadinessFailing` in `prometheus-alerts.yml` (already written against this exporter's metric names for the backend — replicate the pattern with `job="makeable-ai-ready"`/`job="makeable-email-ready"` for the other two).

Either way: alert on `/health`, not just `/ready` — a `/ready` failure could mean "one dependency is down" (real but partial degradation), while a `/health` failure means the process itself isn't responding at all.

## Slow-query alerting

Each of `apps/backend`/`apps/ai`/`apps/email`'s `src/db.ts` wraps every Prisma query (via a client extension, not the deprecated `$use` middleware) with timing, feeding `db_query_duration_seconds{model,operation}` and logging a `slow_query` event for anything over `SLOW_QUERY_THRESHOLD_MS` (500ms). `MakeAbleSlowDatabaseQueries` in `prometheus-alerts.yml` fires on sustained p95 > 500ms for a given model/operation, currently scoped to `job="makeable-backend"` -- copy the rule with a different `job=` selector if you want the same alert for `apps/ai`/`apps/email`.

This measures time inside the Node process (query dispatch to response), not Postgres-side execution plan cost. For query-plan-level analysis (missing indexes, sequential scans), use Supabase's built-in Query Performance dashboard (Project -> Reports -> Query Performance) or enable `pg_stat_statements` directly — this repo's own metric tells you *that* something is slow and roughly *which* query, not *why* at the database level.
