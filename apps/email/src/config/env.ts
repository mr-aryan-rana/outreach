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
  return value.split(",").map((o) => o.trim()).filter(Boolean);
}

function apiKeys(value: string | undefined): string[] {
  const keys = (value ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    throw new Error(
      "Missing required environment variable: EMAIL_API_KEYS (comma-separated -- generate with e.g. `openssl rand -hex 32`)"
    );
  }
  return keys;
}

export const env = {
  port: positiveInt("PORT", process.env.PORT, 8005),
  logLevel: process.env.LOG_LEVEL ?? "info",

  // Own Postgres schema ("email"), same physical Supabase database as
  // apps/backend/apps/ai -- see docs/DATABASE.md "Per-service schema isolation".
  databaseUrl: required("EMAIL_DATABASE_URL"),
  directUrl: required("EMAIL_DIRECT_URL"),

  redisUrl: requiredUrl("REDIS_URL"),
  apiKeys: apiKeys(process.env.EMAIL_API_KEYS),
  corsAllowedOrigins: corsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),

  // apps/email reads draft content from apps/ai over HTTP (never queries its
  // tables directly), and creator identity from apps/backend the same way --
  // same "each service owns its own tables" boundary as apps/ai does for
  // apps/backend. See docs/ARCHITECTURE.md "Email delivery pipeline".
  aiServiceUrl: requiredUrl("AI_SERVICE_URL", "http://localhost:8004"),
  aiServiceApiKey: required("AI_SERVICE_API_KEY"),
  backendUrl: requiredUrl("BACKEND_URL", "http://localhost:3000"),
  backendApiKey: required("BACKEND_API_KEY"),

  requestTimeoutMs: positiveInt("EMAIL_REQUEST_TIMEOUT_MS", process.env.EMAIL_REQUEST_TIMEOUT_MS, 20_000),
  circuitBreakerThreshold: positiveInt(
    "EMAIL_CIRCUIT_BREAKER_THRESHOLD",
    process.env.EMAIL_CIRCUIT_BREAKER_THRESHOLD,
    5
  ),
  rateLimitWindowMs: positiveInt("RATE_LIMIT_WINDOW_MS", process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: positiveInt("RATE_LIMIT_MAX", process.env.RATE_LIMIT_MAX, 60),
  apiKeyRateLimitMax: positiveInt("API_KEY_RATE_LIMIT_MAX", process.env.API_KEY_RATE_LIMIT_MAX, 120),

  // PROJECT.md §12/§17's own documented names/defaults, reused verbatim for
  // consistency with the target platform spec rather than inventing new ones.
  maxEmailsPerDay: positiveInt("MAX_EMAILS_PER_DAY", process.env.MAX_EMAILS_PER_DAY, 200),
  maxEmailsPerHour: positiveInt("MAX_EMAILS_PER_HOUR", process.env.MAX_EMAILS_PER_HOUR, 30),
  emailDelayMinSeconds: positiveInt("EMAIL_DELAY_MIN", process.env.EMAIL_DELAY_MIN, 30),
  emailDelayMaxSeconds: positiveInt("EMAIL_DELAY_MAX", process.env.EMAIL_DELAY_MAX, 120),

  // Queue (requirement #2)
  queueConcurrency: positiveInt("EMAIL_QUEUE_CONCURRENCY", process.env.EMAIL_QUEUE_CONCURRENCY, 1),
  queueMaxAttempts: positiveInt("EMAIL_QUEUE_MAX_ATTEMPTS", process.env.EMAIL_QUEUE_MAX_ATTEMPTS, 3),
  queueBackoffMs: positiveInt("EMAIL_QUEUE_BACKOFF_MS", process.env.EMAIL_QUEUE_BACKOFF_MS, 5_000),

  // Provider credentials -- all optional at boot; only the provider a given
  // SenderProfile actually names needs its key, checked at send time (same
  // "fail at first use, not at startup" philosophy as apps/ai's provider
  // keys). Default "mock" everywhere in this repo's own .env -- see
  // src/providers/mock.ts: zero cost, zero network, zero risk of a real send
  // during development/testing.
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpUsername: process.env.SMTP_USERNAME,
  smtpPassword: process.env.SMTP_PASSWORD,
  resendApiKey: process.env.RESEND_API_KEY,
  sesRegion: process.env.AWS_REGION ?? process.env.SES_REGION,
  sendgridApiKey: process.env.SENDGRID_API_KEY,
};
