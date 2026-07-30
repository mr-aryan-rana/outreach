import request from "supertest";

jest.mock("../src/db", () => ({
  prisma: {
    creator: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import { buildTestApp, TEST_API_KEY } from "./testApp";

describe("API key authentication", () => {
  it("rejects a request with no X-API-Key header", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects a request with a wrong key", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").set("X-API-Key", "totally-wrong-key");
    expect(res.status).toBe(401);
  });

  it("accepts a request with the configured key", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
  });

  it("does not require API key auth for unversioned operational endpoints", async () => {
    const { app } = buildTestApp();
    const health = await request(app).get("/health");
    const ready = await request(app).get("/ready");
    const metrics = await request(app).get("/metrics");
    expect(health.status).toBe(200);
    expect([200, 503]).toContain(ready.status);
    expect(metrics.status).toBe(200);
  });

  it("supports rotation: two keys configured, both old and new authenticate", async () => {
    const original = process.env.API_KEYS;
    process.env.API_KEYS = "old-key,new-key";
    jest.resetModules();
    const { buildTestApp: freshBuildTestApp } = require("./testApp");

    const { app } = freshBuildTestApp();
    const withOld = await request(app).get("/api/v1/creators").set("X-API-Key", "old-key");
    const withNew = await request(app).get("/api/v1/creators").set("X-API-Key", "new-key");
    const withNeither = await request(app).get("/api/v1/creators").set("X-API-Key", "retired-key");

    expect(withOld.status).toBe(200);
    expect(withNew.status).toBe(200);
    expect(withNeither.status).toBe(401);

    process.env.API_KEYS = original;
  });
});
