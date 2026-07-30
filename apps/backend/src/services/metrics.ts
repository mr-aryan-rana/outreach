import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const ingestStageCounter = new client.Counter({
  name: "ingest_stage_total",
  help: "Count of creators reaching each ingest pipeline stage",
  labelNames: ["stage"],
  registers: [registry],
});

export const circuitBreakerState = new client.Gauge({
  name: "circuit_breaker_state",
  help: "Circuit breaker state per downstream service (0=closed, 1=half-open, 2=open)",
  labelNames: ["service"],
  registers: [registry],
});

export const cacheResultCounter = new client.Counter({
  name: "cache_result_total",
  help: "Cache hit/miss count per cache",
  labelNames: ["cache", "result"],
  registers: [registry],
});

export const redisFailureCounter = new client.Counter({
  name: "redis_operation_failures_total",
  help: "Count of Redis operations that failed and fell back to fail-open/degraded behavior",
  labelNames: ["component"],
  registers: [registry],
});

export const dbQueryDuration = new client.Histogram({
  name: "db_query_duration_seconds",
  help: "Prisma query duration in seconds, per model+operation",
  labelNames: ["model", "operation"],
  // Finer-grained than the HTTP histogram at the low end: a query that's
  // "slow" in absolute terms (a few hundred ms) is normal for a full HTTP
  // request but a red flag for a single DB call.
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});
