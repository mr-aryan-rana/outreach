import RedisMock from "ioredis-mock";
import { AppDeps, buildApp } from "../src/app";
import { DuplicateChecker } from "../src/services/duplicateCheck";
import { IdempotencyService } from "../src/services/idempotency";
import { Pipeline } from "../src/services/pipeline";

// Matches API_KEYS set in tests/setupEnv.ts -- every test hitting a
// /api/v1/* route needs to send this (or a dedicated auth test intentionally
// omits/corrupts it to exercise the 401 path).
export const TEST_API_KEY = "test-api-key";

export function fakePipeline(): jest.Mocked<Pipeline> {
  return {
    search: jest.fn(),
    extract: jest.fn(),
    validate: jest.fn(),
  };
}

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const redis = overrides.redis ?? (new RedisMock() as any);
  const deps: AppDeps = {
    redis,
    duplicateChecker: overrides.duplicateChecker ?? new DuplicateChecker(redis),
    pipeline: overrides.pipeline ?? fakePipeline(),
    idempotency: overrides.idempotency ?? new IdempotencyService(redis),
  };
  return { app: buildApp(deps), deps };
}
