import rateLimit, { Store, IncrementResponse } from "express-rate-limit";
import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "../logger";
import { redisFailureCounter } from "../services/metrics";
import { sendError } from "./errors";

const rateLimitedHandler = (req: any, res: any) =>
  sendError(req, res, 429, "rate_limited", "too many requests, please try again later");

const byApiKey = (req: any): string => req.apiKeyId ?? req.ip;

export class RedisFixedWindowStore implements Store {
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
      // live during Sprint 5 testing (heavy repeated traffic against a
      // frequently-restarted dev server left keys with totalHits > 1 and no
      // expiry, presumably from a restart racing the original "totalHits===1"
      // pexpire). Not just first-hit-only: re-arm the TTL any time it's
      // missing, not only when we happen to be the request that created the
      // key.
      if (totalHits === 1 || ttl < 0) {
        await this.redis.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs));
      return { totalHits, resetTime };
    } catch (err) {
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
    store: new RedisFixedWindowStore(redis, "email:ratelimit:general:"),
    handler: rateLimitedHandler,
  });
}

export function buildApiKeyRateLimiter(redis: Redis) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.apiKeyRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisFixedWindowStore(redis, "email:ratelimit:apikey:"),
    keyGenerator: byApiKey,
    validate: { singleCount: false },
    handler: rateLimitedHandler,
  });
}
