import { Router } from "express";
import fetch from "node-fetch";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

interface DependencyCheck {
  name: string;
  ok: boolean;
  error?: string;
}

async function checkPostgres(prisma: PrismaClient): Promise<DependencyCheck> {
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

async function checkHttpService(name: string, baseUrl: string): Promise<DependencyCheck> {
  try {
    const res = await fetch(`${baseUrl}/health`, { timeout: 3000 });
    return { name, ok: res.ok };
  } catch (err) {
    return { name, ok: false, error: (err as Error).message };
  }
}

export function buildHealthRouter(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const checks = await Promise.all([
      checkPostgres(prisma),
      checkRedis(redis),
      checkHttpService("search", env.searchServiceUrl),
      checkHttpService("extractor", env.extractorServiceUrl),
      checkHttpService("validator", env.validatorServiceUrl),
    ]);

    const allOk = checks.every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? "ready" : "not_ready", checks });
  });

  return router;
}
