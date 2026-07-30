# Monitoring

Config artifacts for observing the deployed backend. Nothing here runs itself — these are inputs to infrastructure you provision (Prometheus, Grafana, an uptime checker).

## Files

- `prometheus-alerts.yml` — alert rules. Add to your Prometheus config's `rule_files:`. Assumes a scrape job named `makeable-backend` targeting the backend's `GET /metrics`; rename the `job="..."` selectors throughout if yours differs.
- `grafana-dashboard.json` — importable Grafana dashboard (Dashboards -> Import -> paste JSON, or `grafana-cli`/provisioning). Uses a `DS_PROMETHEUS` datasource variable — map it to your Prometheus datasource on import.

## Metrics reference

All exposed at unversioned `GET /metrics` (Prometheus text format, no auth — see `docs/API.md`):

| Metric | Type | What it tells you |
|---|---|---|
| `http_request_duration_seconds{method,route,status}` | histogram | Request latency + implicitly request rate/error rate (via `_count`) |
| `ingest_stage_total{stage}` | counter | Pipeline funnel: `requested`/`extracted`/`validated`/`stored`/`skipped_duplicate` |
| `circuit_breaker_state{service}` | gauge | 0=closed, 1=half-open, 2=open, per downstream Python service |
| `cache_result_total{cache,result}` | counter | Hit/miss for search-result and validation caches |
| `redis_operation_failures_total{component}` | counter | Redis ops that failed and fell back to fail-open behavior |
| `db_query_duration_seconds{model,operation}` | histogram | Prisma query timing per model+operation — feeds slow-query alerting |
| `process_resident_memory_bytes`, `process_cpu_seconds_total`, `nodejs_*` | various | Default Node process metrics (`prom-client`'s `collectDefaultMetrics`) |

## Uptime monitoring

Not run from inside this repo — needs an external prober (something outside the deployment that can tell the difference between "the app is down" and "the prober itself is down"). Two options, either works:

1. **Third-party synthetic monitoring** (UptimeRobot, Better Uptime, Pingdom, etc.): point it at `GET /health` (liveness — fast, no dependency checks; good for "is the process up") and separately at `GET /ready` (readiness — good for "is the whole system actually functional", since it checks Postgres/Redis/all three Python services). Alert on `/health` failing (process down) as higher severity than `/ready` failing (a dependency is degraded but the process itself is fine).
2. **Prometheus blackbox_exporter**: probe both endpoints, feed `probe_http_status_code` / `probe_success` into Prometheus, alert via `MakeAbleReadinessFailing` in `prometheus-alerts.yml` (already written against this exporter's metric names — update the job label to match your blackbox_exporter scrape config).

Either way: alert on `/health`, not just `/ready` — a `/ready` failure could mean "one Python service is down" (real but partial degradation), while a `/health` failure means the backend process itself isn't responding at all.

## Slow-query alerting

`apps/backend/src/db.ts` wraps every Prisma query (via a client extension, not the deprecated `$use` middleware) with timing, feeding `db_query_duration_seconds{model,operation}` and logging a `slow_query` event for anything over `SLOW_QUERY_THRESHOLD_MS` (500ms, `apps/backend/src/db.ts`). `MakeAbleSlowDatabaseQueries` in `prometheus-alerts.yml` fires on sustained p95 > 500ms for a given model/operation.

This measures time inside the Node process (query dispatch to response), not Postgres-side execution plan cost. For query-plan-level analysis (missing indexes, sequential scans), use Supabase's built-in Query Performance dashboard (Project -> Reports -> Query Performance) or enable `pg_stat_statements` directly — this repo's own metric tells you *that* something is slow and roughly *which* query, not *why* at the database level.
