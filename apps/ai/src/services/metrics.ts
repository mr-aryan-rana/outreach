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
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const circuitBreakerState = new client.Gauge({
  name: "circuit_breaker_state",
  help: "Circuit breaker state per AI provider (0=closed, 1=half-open, 2=open)",
  labelNames: ["provider"],
  registers: [registry],
});

// Requirement #6: track model/provider/prompt_version/latency/token_usage/
// estimated_cost per generation. Metrics give the aggregate/alertable view;
// ai_generations (Postgres) gives the per-generation audit trail -- see
// services/pipeline.ts, which writes both from the same call site.
export const aiGenerationDuration = new client.Histogram({
  name: "ai_generation_duration_seconds",
  help: "LLM call duration in seconds, per provider+stage",
  labelNames: ["provider", "stage", "outcome"],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const aiTokensTotal = new client.Counter({
  name: "ai_tokens_total",
  help: "Total tokens consumed, per provider+stage+kind (prompt|completion)",
  labelNames: ["provider", "stage", "kind"],
  registers: [registry],
});

export const aiEstimatedCostUsdTotal = new client.Counter({
  name: "ai_estimated_cost_usd_total",
  help: "Estimated USD cost of LLM calls, per provider+stage",
  labelNames: ["provider", "stage"],
  registers: [registry],
});

export const aiProviderFailuresTotal = new client.Counter({
  name: "ai_provider_failures_total",
  help: "Count of failed provider calls, per provider+reason",
  labelNames: ["provider", "reason"],
  registers: [registry],
});

export const aiFallbackUsedTotal = new client.Counter({
  name: "ai_fallback_used_total",
  help: "Count of generations that used the fallback provider instead of the primary",
  labelNames: ["primary", "fallback", "stage"],
  registers: [registry],
});
