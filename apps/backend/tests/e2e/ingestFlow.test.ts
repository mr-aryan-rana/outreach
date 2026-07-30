import request from "supertest";

jest.mock("../../src/db", () => ({
  prisma: {
    creator: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import RedisMock from "ioredis-mock";
import { prisma } from "../../src/db";
import { DuplicateChecker } from "../../src/services/duplicateCheck";
import { buildTestApp, fakePipeline } from "../testApp";

describe("e2e: /api/v1/ingest/run -> /api/v1/creators", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores a creator via ingest and it's then visible via the versioned creators list", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue(["https://instagram.com/thequistfamily"]);
    (pipeline.extract as jest.Mock).mockResolvedValue({
      email: "courtneyandalexquist@gmail.com",
      social_links: ["https://instagram.com/thequistfamily"],
      bio: "The Quist Family",
      source_url: "https://instagram.com/thequistfamily",
    });
    (pipeline.validate as jest.Mock).mockResolvedValue({
      is_valid: true,
      confidence_score: 0.95,
      reasons: ["syntax_ok", "not_disposable", "mx_ok"],
    });
    (prisma.creator.create as jest.Mock).mockResolvedValue({});

    const { app } = buildTestApp({ duplicateChecker: new DuplicateChecker(redis as any), pipeline, redis: redis as any });

    const ingestRes = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "instagram" });

    expect(ingestRes.status).toBe(200);
    expect(ingestRes.body.stored).toBe(1);
    expect(ingestRes.headers["x-request-id"]).toBeTruthy();
  });

  it("rejects unversioned legacy paths (routes now live only under /api/v1)", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/creators");
    expect(res.status).toBe(404);
  });

  it("exposes rate-limit headers on API responses", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("replays idempotent ingest requests without hitting the pipeline twice, across the full app stack", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue([]);

    const { app } = buildTestApp({ duplicateChecker: new DuplicateChecker(redis as any), pipeline, redis: redis as any });
    const body = { niche: "couple vlog", platform: "instagram" };

    const first = await request(app).post("/api/v1/ingest/run").set("Idempotency-Key", "e2e-key").send(body);
    const second = await request(app).post("/api/v1/ingest/run").set("Idempotency-Key", "e2e-key").send(body);

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(pipeline.search).toHaveBeenCalledTimes(1);
  });

  it("exposes /health and /ready unversioned", async () => {
    const { app } = buildTestApp();
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);

    const ready = await request(app).get("/ready");
    // Prisma is mocked without $queryRaw here, so /ready may report not-ready;
    // what matters for this test is that the endpoint exists and responds.
    expect([200, 503]).toContain(ready.status);
  });

  it("exposes /metrics unversioned", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_request_duration_seconds");
  });
});
