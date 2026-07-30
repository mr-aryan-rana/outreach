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
  help: "Circuit breaker state per email provider (0=closed, 1=half-open, 2=open)",
  labelNames: ["provider"],
  registers: [registry],
});

export const emailSendDuration = new client.Histogram({
  name: "email_send_duration_seconds",
  help: "Provider send call duration in seconds, per provider+outcome",
  labelNames: ["provider", "outcome"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20],
  registers: [registry],
});

export const emailEventsTotal = new client.Counter({
  name: "email_events_total",
  help: "Count of email lifecycle events, per event type",
  labelNames: ["eventType"],
  registers: [registry],
});

export const emailProviderFailuresTotal = new client.Counter({
  name: "email_provider_failures_total",
  help: "Count of failed provider send calls, per provider+reason",
  labelNames: ["provider", "reason"],
  registers: [registry],
});

export const emailSuppressedTotal = new client.Counter({
  name: "email_suppressed_total",
  help: "Count of recipients skipped because they're on the suppression list",
  registers: [registry],
});

export const emailDuplicateSkippedTotal = new client.Counter({
  name: "email_duplicate_skipped_total",
  help: "Count of recipients skipped as a duplicate within the same campaign",
  registers: [registry],
});

export const queueJobsTotal = new client.Counter({
  name: "email_queue_jobs_total",
  help: "Count of queue jobs, per outcome (completed|failed|dead_letter)",
  labelNames: ["outcome"],
  registers: [registry],
});
