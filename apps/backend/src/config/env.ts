function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  searchServiceUrl: required("SEARCH_SERVICE_URL", "http://localhost:8001"),
  extractorServiceUrl: required("EXTRACTOR_SERVICE_URL", "http://localhost:8002"),
  validatorServiceUrl: required("VALIDATOR_SERVICE_URL", "http://localhost:8003"),
  cacheTtlSeconds: Number(process.env.CACHE_TTL ?? 3600),
  validationTtlSeconds: Number(process.env.VALIDATION_TTL ?? 86400),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT ?? 20) * 1000,
  logLevel: process.env.LOG_LEVEL ?? "info",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  ingestRateLimitMax: Number(process.env.INGEST_RATE_LIMIT_MAX ?? 10),
  circuitBreakerThreshold: Number(process.env.CIRCUIT_BREAKER_THRESHOLD ?? 5),
  idempotencyTtlSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 86_400),
};
