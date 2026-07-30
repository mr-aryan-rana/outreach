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

// See apps/backend/src/config/env.ts for the rotation rationale -- identical
// pattern here.
function apiKeys(value: string | undefined): string[] {
  const keys = (value ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    throw new Error(
      "Missing required environment variable: AI_API_KEYS (comma-separated -- generate with e.g. `openssl rand -hex 32`)"
    );
  }
  return keys;
}

export type ProviderName = "openai" | "anthropic" | "gemini" | "mock";

function providerName(name: string, value: string | undefined, fallback: ProviderName): ProviderName {
  const v = (value ?? fallback) as ProviderName;
  if (!["openai", "anthropic", "gemini", "mock"].includes(v)) {
    throw new Error(`Environment variable ${name} must be one of openai|anthropic|gemini|mock, got "${v}"`);
  }
  return v;
}

// Fail fast and loud on boot -- same philosophy as apps/backend/src/config/env.ts.
export const env = {
  port: positiveInt("PORT", process.env.PORT, 8004),
  logLevel: process.env.LOG_LEVEL ?? "info",

  // Own Postgres schema ("ai"), same physical Supabase database as the
  // backend -- see prisma/schema.prisma and docs/DATABASE.md "AI schema
  // isolation". Deliberately separate env vars from the backend's
  // DATABASE_URL/DIRECT_URL so this service's migration history
  // (_prisma_migrations, scoped per-schema) never collides with the
  // backend's.
  databaseUrl: required("AI_DATABASE_URL"),
  directUrl: required("AI_DIRECT_URL"),

  redisUrl: requiredUrl("REDIS_URL"),
  apiKeys: apiKeys(process.env.AI_API_KEYS),
  corsAllowedOrigins: corsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),

  // The AI service reads creator content (bio/socialLinks/niche) from the
  // backend's own API rather than querying apps/backend's tables directly --
  // preserves the existing "each service owns its own tables" boundary
  // (docs/ARCHITECTURE.md) instead of coupling two Prisma schemas to one
  // table definition.
  backendUrl: requiredUrl("BACKEND_URL", "http://localhost:4000"),
  backendApiKey: required("BACKEND_API_KEY"),

  requestTimeoutMs: positiveInt("AI_REQUEST_TIMEOUT_MS", process.env.AI_REQUEST_TIMEOUT_MS, 30_000),
  circuitBreakerThreshold: positiveInt(
    "AI_CIRCUIT_BREAKER_THRESHOLD",
    process.env.AI_CIRCUIT_BREAKER_THRESHOLD,
    5
  ),
  rateLimitWindowMs: positiveInt("RATE_LIMIT_WINDOW_MS", process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: positiveInt("RATE_LIMIT_MAX", process.env.RATE_LIMIT_MAX, 60),
  apiKeyRateLimitMax: positiveInt("API_KEY_RATE_LIMIT_MAX", process.env.API_KEY_RATE_LIMIT_MAX, 120),

  // Provider credentials -- all optional at the env-validation level (a
  // provider with no key configured is simply unavailable, see
  // providers/registry.ts); only the *selected* primary/fallback need a key
  // actually present, checked at first use, not at boot, so the service can
  // still start (health checks, prompt management, DB access) even if only
  // one provider is configured.
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,

  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",

  // Never lock to one provider (Sprint 3 requirement): both configurable,
  // fallback used only if the primary's circuit breaker is open or it
  // exhausts its retries -- see services/pipeline.ts.
  primaryProvider: providerName("AI_PRIMARY_PROVIDER", process.env.AI_PRIMARY_PROVIDER, "openai"),
  fallbackProvider: providerName("AI_FALLBACK_PROVIDER", process.env.AI_FALLBACK_PROVIDER, "anthropic"),
};
