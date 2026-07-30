# Operations

Day-2 runbook for `apps/backend` + the three Python services. For first deploy, see `DEPLOYMENT.md`. For diagnosing a specific symptom, see `TROUBLESHOOTING.md`.

## Daily / routine checks

- `GET /ready` on the backend — if any check is `false`, see `TROUBLESHOOTING.md` for that dependency.
- `GET /metrics` — watch `circuit_breaker_state{service}` (should be `0` closed for all three services under normal operation) and the `ingest_stage_total{stage="requested"}` vs `{stage="stored"}` ratio (a collapsing ratio means the pipeline is failing most candidates somewhere before storage).
- Dependabot PRs (`.github/dependabot.yml`, weekly) for the backend and each Python service — review and merge; don't let them pile up.
- **Monitoring verified (RC2)**: every metric referenced in `monitoring/grafana-dashboard.json` and `monitoring/prometheus-alerts.yml` was confirmed live and populated against the real deployment during RC2 verification — `circuit_breaker_state`, `db_query_duration_seconds`, `ingest_stage_total`, `cache_result_total`, `redis_operation_failures_total`, `process_resident_memory_bytes`, `process_cpu_seconds_total` all present with real values in `/metrics` output.

## Common runbook actions

### Rotate a credential (Supabase password, Upstash token)

1. Generate the new credential in the Supabase/Upstash dashboard.
2. Update `DATABASE_URL`/`DIRECT_URL`/`REDIS_URL` in the deployment environment (secret manager / platform env config — never in a committed file).
3. Restart the backend (`SIGTERM`, graceful drain — see `DEPLOYMENT.md` "Known operational limits" for the current verification status of that drain). Prisma and ioredis both pick up the new connection string on process start; there is no live credential-reload path, a restart is required.
4. Confirm `GET /ready` reports the relevant dependency `ok: true` post-restart before considering the rotation complete.
5. Revoke the old credential only after confirming the new one is live everywhere it's needed (don't revoke-then-verify).

### Manually correct a bad `Creator`/`Email` row in Postgres

Because Redis duplicate-prevention keys are TTL-only with no explicit invalidation path (`docs/DATABASE.md` "Cache invalidation"), deleting a row directly in Postgres does **not** clear its `creator:email:{email}` / `creator:website:{domain}` Redis key. Until that key's TTL (`DUPLICATE_TTL_SECONDS`, default 30 days) expires, the pipeline will keep treating that email/URL as already-seen and skip it — even though the Postgres row is gone.

1. Delete/correct the row(s) in Postgres.
2. Also delete the corresponding Redis key(s):
   ```bash
   redis-cli -u "$REDIS_URL" DEL "creator:email:<email lowercased>"
   redis-cli -u "$REDIS_URL" DEL "creator:website:<hostname><pathname, no trailing slash>"
   ```
   (see `apps/backend/src/services/duplicateCheck.ts` for the exact key-normalization rules if unsure).
3. Skip step 2 only if you *want* that email/URL to keep being treated as already-processed.

### Recover from a full Redis flush/outage

Safe by design: Redis is a cache/dedup fast-path, Postgres unique constraints are the real guarantee (`docs/DATABASE.md`). After Redis comes back:
- Rate limiting resumes enforcing (it fails open while Redis is down — see `docs/API.md`).
- Duplicate prevention temporarily runs "slow path only" — the pipeline re-does search/extract/validate for creators already in Postgres until Redis marks them seen again, but `store_conflict` in `apps/backend/src/routes/ingest.ts` still prevents any actual duplicate row. No manual cleanup needed.
- Idempotency replay (`Idempotency-Key`) stops working for keys used during the outage — a retried request with the same key will re-run the pipeline instead of replaying. Not dangerous (duplicate prevention still holds), just not idempotent for that window.

### Roll back a bad deploy

See `DEPLOYMENT.md` "Rollback" for the schema/data-safety details. Operationally: redeploy the previous image/commit for the affected service(s); the backend and each Python service are independently deployable and stateless, so this doesn't require a coordinated multi-service rollback unless the bad deploy was a Prisma migration.

### Respond to a downstream service circuit breaker stuck open

`circuit_breaker_state{service="search"|"extractor"|"validator"} == 2` sustained means that service has failed `CIRCUIT_BREAKER_THRESHOLD` (default 5) consecutive calls and the breaker is refusing new calls (failing fast with `503`) rather than piling up retries.

1. Check that service's own health/logs directly (`GET http://<service>:<port>/health`) — is it actually down, slow, or erroring?
2. Fix the underlying service issue first; the breaker self-recovers via a half-open probe 10s after opening (`apps/backend/src/services/resilience.ts`) — no manual "reset" action exists or is needed.
3. If the service is healthy but the breaker won't close, check whether `REQUEST_TIMEOUT` is too aggressive for current load/network conditions (timeouts count as failures toward the breaker threshold).

## Disaster recovery

**Status (RC2): Redis-side procedure verified live; Postgres restore procedure still documented-only, not yet drilled.** RC1/RC2 verified the app, Postgres, and Redis are all live and reachable (see `RELEASE.md`), and confirmed the app degrades correctly during a Redis outage (fail-open rate limiting, `/ready` correctly reports it) — but an actual Supabase *backup restore* requires dashboard/billing access this session didn't have; only the documented procedure below has been reviewed, not executed end-to-end. Run that drill for real the first time someone has Supabase dashboard access, then update this line with the date and outcome.

### Postgres restore (Supabase)

1. In the Supabase dashboard: Project -> Database -> Backups. Confirm what's available — daily automated backups (free/pro tiers) or Point-in-Time Recovery to any second within the retention window (paid tiers with PITR enabled). Know which one your project actually has *before* an incident, not during one.
2. Trigger a restore to a **new** project/branch if your plan supports it, rather than restoring in place — lets you verify the restored data before cutting traffic over, and gives you a rollback path if the restore itself was wrong (restoring the wrong point in time, etc.).
3. Post-restore, before resuming traffic:
   ```bash
   npx prisma migrate status   # confirm the restored schema matches prisma/schema.prisma --
                                # migrations applied after the backup point will be missing
   ```
   If `migrate status` reports pending migrations, run `npx prisma migrate deploy` against the restored database to bring it current before pointing the app at it.
4. Spot-check row counts / a few known rows against what you expected at the backup timestamp.
5. Update `DATABASE_URL`/`DIRECT_URL` to point at the restored database (or, if restored in-place, no config change needed) and restart the backend (graceful `SIGTERM`, see `DEPLOYMENT.md`).
6. Confirm `GET /ready` reports `postgres: ok`.

**RPO/RTO**: bounded by your Supabase plan's backup frequency/PITR window (RPO) and how long dashboard restore + steps 3-6 take (RTO, typically minutes once the restore itself completes — Supabase's own restore time depends on database size, outside this app's control). Confirm actual numbers against your specific plan; don't assume.

### Redis recovery (Upstash)

Redis holds no data that isn't safely reconstructable — see "Recover from a full Redis flush/outage" above. There is no restore procedure to test because there's nothing that needs restoring: an empty/fresh Upstash database is a valid recovery state on its own. If Upstash's own dashboard shows a snapshot/backup feature for your plan, restoring from one is a strict improvement (repopulates caches faster) but is never required for correctness.

To simulate this failure mode deliberately (e.g. as part of a DR game day): `redis-cli -u "$REDIS_URL" FLUSHALL` against a **non-production** Redis instance, then confirm the backend continues serving `/api/v1/*` traffic (degraded — see "Recover from a full Redis flush/outage") and self-heals as new keys get written. Never run `FLUSHALL` against a real instance outside of a deliberate, approved drill.

### What "disaster recovery" does *not* cover here

- No cross-region failover — Supabase/Upstash are each single-region for this project; a regional outage of either provider is an availability incident to wait out, not something this app can route around today.
- No automated backup verification job — "the backup exists" is not the same as "the backup restores cleanly"; the manual drill above is the only current verification, so schedule it periodically (e.g. quarterly), not just once.

## Scaling notes

- Backend and all three Python services are stateless and horizontally scalable — add instances behind a load balancer; rate limiting and idempotency are already Redis-backed so they stay correct across multiple backend instances.
- `POST /api/v1/ingest/run` is synchronous per request (`DEPLOYMENT.md` "Known operational limits") — under high concurrent ingest load, HTTP connections stay open for the full pipeline duration. There is no job queue yet; if ingest volume grows significantly beyond `PROJECT.md`'s 200/day target, that's the first architectural change to plan (see "Recommended Next Sprint" in the readiness report).
- Supabase/Upstash free-tier connection limits are the likely first ceiling when adding backend instances — check the plan's connection cap against `(instances × Prisma connection_limit)` (`docs/DATABASE.md` "Connection pooling") before scaling out.
