import { Router } from "express";
import fetch from "node-fetch";
import Redis from "ioredis";
import { env } from "../config/env";

interface DependencyCheck {
  name: string;
  ok: boolean;
  error?: string;
}

interface QueryableDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

async function checkPostgres(prisma: QueryableDb): Promise<DependencyCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: "postgres", ok: true };
  } catch (err) {
    return { name: "postgres", ok: false, error: (err as Error).message };
  }
}

async function checkRedis(redis: Redis): Promise<DependencyCheck> {
  try {
    const pong = await redis.ping();
    return { name: "redis", ok: pong === "PONG" };
  } catch (err) {
    return { name: "redis", ok: false, error: (err as Error).message };
  }
}

async function checkBackend(): Promise<DependencyCheck> {
  try {
    const res = await fetch(`${env.backendUrl}/health`, { timeout: 3000 });
    return { name: "backend", ok: res.ok };
  } catch (err) {
    return { name: "backend", ok: false, error: (err as Error).message };
  }
}

/**
 * Readiness deliberately does NOT check any AI provider -- a provider being
 * down is expected/recoverable (retry -> circuit breaker -> fallback
 * provider, see providers/registry.ts), not a reason to pull this whole
 * service out of rotation. Postgres/Redis/backend are the only true hard
 * dependencies.
 */
export function buildHealthRouter(prisma: QueryableDb, redis: Redis): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const checks = await Promise.all([checkPostgres(prisma), checkRedis(redis), checkBackend()]);
    const allOk = checks.every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? "ready" : "not_ready", checks });
  });

  return router;
}
