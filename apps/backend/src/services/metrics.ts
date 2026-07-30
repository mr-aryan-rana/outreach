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
