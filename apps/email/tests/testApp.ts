import RedisMock from "ioredis-mock";
import { AppDeps, buildApp } from "../src/app";

export const TEST_API_KEY = "test-email-api-key";

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const redis = overrides.redis ?? (new RedisMock() as any);
  const deps: AppDeps = { redis };
  return { app: buildApp(deps), deps };
}
