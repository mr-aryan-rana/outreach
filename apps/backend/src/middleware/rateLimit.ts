import rateLimit, { Store, IncrementResponse } from "express-rate-limit";
import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "../logger";
import { sendError } from "./errors";
import { redisFailureCounter } from "../services/metrics";

const rateLimitedHandler = (req: any, res: any) =>
  sendError(req, res, 429, "rate_limited", "too many requests, please try again later");

// Runs after apiKeyAuth (see app.ts route order), so req.apiKeyId is always
// set for routes this key generator is attached to; the IP fallback only
// guards against future route-order mistakes, not normal operation.
const byApiKey = (req: any): string => req.apiKeyId ?? req.ip;

class RedisFixedWindowStore implements Store {
  windowMs = env.rateLimitWindowMs;

  constructor(private readonly redis: Redis, private readonly keyPrefix: string) {}

  private key(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = this.key(key);
    try {
      const totalHits = await this.redis.incr(redisKey);
      let ttl = await this.redis.pttl(redisKey);
      // Self-heal: a key with no TTL (-1) never resets and would permanently
      // rate-limit this caller until someone manually clears Redis -- found
      // live in apps/email during Sprint 5 testing (same store implementation
      // duplicated across all three services), root cause not fully isolated
      // but reproduced under heavy repeated traffic against a
      // frequently-restarted dev server. Re-arm the TTL any time it's
      // missing, not only on the request that happens to create the key.
      if (totalHits === 1 || ttl < 0) {
        await this.redis.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs));
      return { totalHits, resetTime };
    } catch (err) {
      // Fail open: a rate limiter that can't reach its own store must not
      // block all API traffic. Observed during verification -- a Redis
      // outage made every request (including ones with no other Redis
      // dependency) hang for 10+ seconds and then 500. Report hit 1 (always
      // under the limit) so the request proceeds; the limiter resumes
      // enforcing once Redis recovers. Still surfaced via logs/metrics so a
      // sustained outage (== unenforced rate limits) is visible to on-call
      // instead of silently degrading.
      logger.warn({ event: "rate_limit_store_error", key, error: (err as Error).message });
      redisFailureCounter.labels("rate_limit").inc();
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(this.key(key)).catch(() => undefined);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.key(key)).catch(() => undefined);
  }
}

export function buildGeneralRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "ratelimit:general:"),
    handler: rateLimitedHandler,
  });
}

export function buildIngestRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.ingestRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "ratelimit:ingest:"),
    // Per API key, not per IP: multiple credentialed callers can share an
    // IP (NAT, shared egress), and should each get their own ingest quota.
    keyGenerator: byApiKey,
    // This limiter intentionally stacks on top of the general one for the
    // same request (general + ingest-specific), which the library's
    // double-count heuristic otherwise flags as a likely bug.
    validate: { singleCount: false },
    handler: rateLimitedHandler,
  });
}

// Per-API-key quota on top of the per-IP general limiter above -- see
// config/env.ts apiKeyRateLimitMax for why this exists alongside, not
// instead of, IP-based limiting.
export function buildApiKeyRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.apiKeyRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "ratelimit:apikey:"),
    keyGenerator: byApiKey,
    validate: { singleCount: false },
    handler: rateLimitedHandler,
  });
}
