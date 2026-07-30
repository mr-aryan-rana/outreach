function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredUrl(name: string, fallback?: string): string {
  const value = required(name, fallback);
  try {
    new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} is not a valid URL: "${value}"`);
  }
  return value;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function corsAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Comma-separated so rotation is a two-step, zero-downtime deploy: (1) add
// the new key alongside the old one and deploy, (2) once every caller has
// switched, remove the old key and deploy again. Both keys authenticate
// during step 1's overlap window.
function apiKeys(value: string | undefined): string[] {
  const keys = (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error(
      "Missing required environment variable: API_KEYS (comma-separated -- generate with e.g. `openssl rand -hex 32`)"
    );
  }
  return keys;
}

// Fail fast and loud on boot rather than surfacing confusing errors deep in
// a request handler the first time a misconfigured value gets used.
export const env = {
  port: positiveInt("PORT", process.env.PORT, 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: requiredUrl("REDIS_URL"),
  searchServiceUrl: requiredUrl("SEARCH_SERVICE_URL", "http://localhost:8001"),
  extractorServiceUrl: requiredUrl("EXTRACTOR_SERVICE_URL", "http://localhost:8002"),
  validatorServiceUrl: requiredUrl("VALIDATOR_SERVICE_URL", "http://localhost:8003"),
  cacheTtlSeconds: positiveInt("CACHE_TTL", process.env.CACHE_TTL, 3600),
  validationTtlSeconds: positiveInt("VALIDATION_TTL", process.env.VALIDATION_TTL, 86400),
  // Deliberately separate from cacheTtlSeconds: that TTL is tuned for
  // ephemeral search-result caching (1h default), but these keys are the
  // Redis fast-path for duplicate prevention (docs/DATABASE.md). Sharing the
  // 1h TTL meant a creator whose email was already stored would silently
  // re-enter the full search->extract->validate pipeline (wasting all three
  // downstream service calls) once the cache entry expired -- Postgres's
  // unique constraint still caught the actual duplicate insert, but only
  // after redoing all the expensive work. Default to 30 days.
  duplicateTtlSeconds: positiveInt("DUPLICATE_TTL_SECONDS", process.env.DUPLICATE_TTL_SECONDS, 30 * 24 * 3600),
  requestTimeoutMs: positiveInt("REQUEST_TIMEOUT", process.env.REQUEST_TIMEOUT, 20) * 1000,
  logLevel: process.env.LOG_LEVEL ?? "info",
  rateLimitWindowMs: positiveInt("RATE_LIMIT_WINDOW_MS", process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: positiveInt("RATE_LIMIT_MAX", process.env.RATE_LIMIT_MAX, 120),
  ingestRateLimitMax: positiveInt("INGEST_RATE_LIMIT_MAX", process.env.INGEST_RATE_LIMIT_MAX, 10),
  // Per-API-key quota, on top of (not instead of) the per-IP limiters above:
  // the IP-based limiter bounds raw request volume from any single source
  // (including pre-auth/brute-force traffic); this bounds how much of the
  // shared backend one *credentialed tenant* can consume, independent of
  // how many keys happen to share a NAT/IP.
  apiKeyRateLimitMax: positiveInt("API_KEY_RATE_LIMIT_MAX", process.env.API_KEY_RATE_LIMIT_MAX, 300),
  circuitBreakerThreshold: positiveInt("CIRCUIT_BREAKER_THRESHOLD", process.env.CIRCUIT_BREAKER_THRESHOLD, 5),
  idempotencyTtlSeconds: positiveInt("IDEMPOTENCY_TTL_SECONDS", process.env.IDEMPOTENCY_TTL_SECONDS, 86_400),
  // Empty by default: this API has no auth layer yet and is documented as
  // not internet-facing (docs/SECURITY.md), so cross-origin browser access
  // is denied unless explicitly opted into for a known frontend origin.
  corsAllowedOrigins: corsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  apiKeys: apiKeys(process.env.API_KEYS),
};

// DATABASE_URL is validated for shape (not just presence) here rather than
// with requiredUrl() because Prisma connection strings carry extra query
// params (pgbouncer=true) that URL parsing handles fine, but a plain typo
// (e.g. missing "postgresql://") should still fail at boot, not at first query.
if (!/^postgres(ql)?:\/\//.test(env.databaseUrl)) {
  throw new Error('Environment variable DATABASE_URL must start with "postgresql://" or "postgres://"');
}
