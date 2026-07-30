import { Writable } from "stream";
import pino from "pino";
import pinoHttp from "pino-http";
import express from "express";
import request from "supertest";
import { LOG_REDACT_PATHS } from "../src/logger";
import { buildTestApp, TEST_API_KEY } from "./testApp";

describe("security/reliability hardening", () => {
  it("sets Helmet security headers", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
  });

  it("denies cross-origin requests by default (no CORS_ALLOWED_ORIGINS configured)", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/creators")
      .set("X-API-Key", TEST_API_KEY)
      .set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the standard error envelope on validation failure", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/ingest/run").set("X-API-Key", TEST_API_KEY).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_body" });
    expect(res.body.error.message).toEqual(expect.any(String));
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it("returns the standard error envelope for unmatched routes", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/does-not-exist").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "not_found" });
  });

  it("serves the OpenAPI docs UI", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api-docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger");
  });

  it("never logs the X-API-Key header value (redacted, not omitted)", async () => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const testLogger = pino({ redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" } }, sink);

    const app = express();
    app.use(pinoHttp({ logger: testLogger }));
    app.get("/x", (_req, res) => res.send("ok"));

    await request(app).get("/x").set("X-API-Key", TEST_API_KEY);

    const logged = Buffer.concat(chunks).toString("utf8");
    expect(logged).not.toContain(TEST_API_KEY);
    expect(logged).toContain("[Redacted]");
  });
});
