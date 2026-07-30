import request from "supertest";

jest.mock("../src/db", () => ({
  prisma: {
    creator: {
      create: jest.fn(),
    },
  },
}));

import RedisMock from "ioredis-mock";
import { prisma } from "../src/db";
import { DuplicateChecker } from "../src/services/duplicateCheck";
import { buildTestApp, fakePipeline } from "./testApp";

function fakeChecker(redis: any, seenEmails: string[] = [], seenSites: string[] = []) {
  for (const email of seenEmails) {
    redis.set(`creator:email:${email.toLowerCase()}`, "1");
  }
  for (const site of seenSites) {
    redis.set(`creator:website:${site}`, "1");
  }
  return new DuplicateChecker(redis);
}

describe("POST /api/v1/ingest/run", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a request missing niche/platform", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/ingest/run").send({});
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported platform", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "mastodon" });
    expect(res.status).toBe(400);
  });

  it("runs the full pipeline and stores validated, non-duplicate creators", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue(["https://instagram.com/a"]);
    (pipeline.extract as jest.Mock).mockResolvedValue({
      email: "a@example.com",
      social_links: [],
      bio: "bio",
      source_url: "https://instagram.com/a",
    });
    (pipeline.validate as jest.Mock).mockResolvedValue({
      is_valid: true,
      confidence_score: 0.9,
      reasons: ["syntax_ok", "mx_ok"],
    });
    (prisma.creator.create as jest.Mock).mockResolvedValue({});

    const { app } = buildTestApp({ duplicateChecker: fakeChecker(redis), pipeline, redis: redis as any });
    const res = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "instagram" });

    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(1);
    expect(res.body.skippedDuplicates).toBe(0);
    expect(prisma.creator.create).toHaveBeenCalledTimes(1);
  });

  it("skips a URL whose email was already seen (duplicate prevention)", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue(["https://instagram.com/a"]);
    (pipeline.extract as jest.Mock).mockResolvedValue({
      email: "a@example.com",
      social_links: [],
      bio: "bio",
      source_url: "https://instagram.com/a",
    });

    const { app } = buildTestApp({
      duplicateChecker: fakeChecker(redis, ["a@example.com"]),
      pipeline,
      redis: redis as any,
    });
    const res = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "instagram" });

    expect(res.body.skippedDuplicates).toBe(1);
    expect(res.body.stored).toBe(0);
    expect(prisma.creator.create).not.toHaveBeenCalled();
  });

  it("does not store an email that failed validation", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue(["https://instagram.com/a"]);
    (pipeline.extract as jest.Mock).mockResolvedValue({
      email: "a@example.com",
      social_links: [],
      bio: "bio",
      source_url: "https://instagram.com/a",
    });
    (pipeline.validate as jest.Mock).mockResolvedValue({
      is_valid: false,
      confidence_score: 0.2,
      reasons: ["mx_failed"],
    });

    const { app } = buildTestApp({ duplicateChecker: fakeChecker(redis), pipeline, redis: redis as any });
    const res = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "instagram" });

    expect(res.body.stored).toBe(0);
    expect(prisma.creator.create).not.toHaveBeenCalled();
  });

  it("returns 502 when the search service is unavailable", async () => {
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockRejectedValue(new Error("connection refused"));

    const { app } = buildTestApp({ pipeline });
    const res = await request(app)
      .post("/api/v1/ingest/run")
      .send({ niche: "couple vlog", platform: "instagram" });

    expect(res.status).toBe(502);
  });

  it("replays a cached result for a repeated Idempotency-Key without re-running the pipeline", async () => {
    const redis = new RedisMock();
    const pipeline = fakePipeline();
    (pipeline.search as jest.Mock).mockResolvedValue(["https://instagram.com/a"]);
    (pipeline.extract as jest.Mock).mockResolvedValue({
      email: "a@example.com",
      social_links: [],
      bio: "bio",
      source_url: "https://instagram.com/a",
    });
    (pipeline.validate as jest.Mock).mockResolvedValue({
      is_valid: true,
      confidence_score: 0.9,
      reasons: ["syntax_ok", "mx_ok"],
    });
    (prisma.creator.create as jest.Mock).mockResolvedValue({});

    const { app } = buildTestApp({ duplicateChecker: fakeChecker(redis), pipeline, redis: redis as any });
    const body = { niche: "couple vlog", platform: "instagram" };

    const first = await request(app).post("/api/v1/ingest/run").set("Idempotency-Key", "key-1").send(body);
    const second = await request(app).post("/api/v1/ingest/run").set("Idempotency-Key", "key-1").send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(pipeline.search).toHaveBeenCalledTimes(1);
  });
});
