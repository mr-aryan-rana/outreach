jest.mock("../../src/db", () => ({
  prisma: {
    aiGeneration: { groupBy: jest.fn(), count: jest.fn() },
    promptTemplate: { findUnique: jest.fn() },
  },
}));

jest.mock("../../src/prompts/promptLoader", () => ({
  listPromptNames: jest.fn(),
  loadPromptVersions: jest.fn(),
}));

import request from "supertest";
import { prisma } from "../../src/db";
import { listPromptNames, loadPromptVersions } from "../../src/prompts/promptLoader";
import { buildTestApp, TEST_API_KEY } from "../testApp";

describe("GET /api/v1/ai/providers/health", () => {
  it("reports configuration + circuit breaker state per provider, never making a real call", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/providers/health").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "mock", configured: true, circuitBreakerState: "closed" })])
    );
    expect(res.body.primaryProvider).toBeDefined();
  });
});

describe("GET /api/v1/ai/usage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects an invalid provider filter", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/usage?provider=notreal").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(400);
  });

  it("aggregates cost/tokens grouped by provider and stage", async () => {
    (prisma.aiGeneration.groupBy as jest.Mock).mockResolvedValue([
      {
        provider: "mock",
        stage: "creator_summary",
        _sum: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUsd: 0.001 },
        _count: { _all: 3 },
        _avg: { latencyMs: 42.4 },
      },
    ]);
    (prisma.aiGeneration.count as jest.Mock).mockResolvedValue(1);

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/usage").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ totalTokens: 150, generations: 3, fallbackUsedCount: 1 });
    expect(res.body.byProviderAndStage[0]).toMatchObject({ provider: "mock", stage: "creator_summary", avgLatencyMs: 42 });
  });
});

describe("GET /api/v1/ai/prompts/verify", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports no drift when file and DB content match", async () => {
    (listPromptNames as jest.Mock).mockReturnValue(["creator-summary"]);
    (loadPromptVersions as jest.Mock).mockReturnValue([{ name: "creator-summary", version: 1, content: "hello", variables: [] }]);
    (prisma.promptTemplate.findUnique as jest.Mock).mockResolvedValue({
      versions: [{ version: 1, content: "hello" }],
    });

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/prompts/verify").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.anyDrift).toBe(false);
    expect(res.body.items[0].versions[0]).toMatchObject({ version: 1, syncedToDb: true, driftDetected: false });
  });

  it("detects drift when the file was edited without bumping the version", async () => {
    (listPromptNames as jest.Mock).mockReturnValue(["creator-summary"]);
    (loadPromptVersions as jest.Mock).mockReturnValue([{ name: "creator-summary", version: 1, content: "edited content", variables: [] }]);
    (prisma.promptTemplate.findUnique as jest.Mock).mockResolvedValue({
      versions: [{ version: 1, content: "original content" }],
    });

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/prompts/verify").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.anyDrift).toBe(true);
    expect(res.body.items[0].hasDrift).toBe(true);
  });

  it("reports a version as not yet synced when no DB template exists", async () => {
    (listPromptNames as jest.Mock).mockReturnValue(["new-prompt"]);
    (loadPromptVersions as jest.Mock).mockReturnValue([{ name: "new-prompt", version: 1, content: "x", variables: [] }]);
    (prisma.promptTemplate.findUnique as jest.Mock).mockResolvedValue(null);

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/prompts/verify").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.items[0].versions[0]).toMatchObject({ syncedToDb: false, driftDetected: false });
  });
});
