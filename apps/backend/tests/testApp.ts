import RedisMock from "ioredis-mock";
import { AppDeps, buildApp } from "../src/app";
import { DuplicateChecker } from "../src/services/duplicateCheck";
import { IdempotencyService } from "../src/services/idempotency";
import { Pipeline } from "../src/services/pipeline";

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
