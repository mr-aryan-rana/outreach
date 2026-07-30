import request from "supertest";

jest.mock("../src/db", () => ({
  prisma: {
    creator: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from "../src/db";
import { buildTestApp, TEST_API_KEY } from "./testApp";

describe("GET /api/v1/creators", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns paginated results with defaults", async () => {
    (prisma.creator.count as jest.Mock).mockResolvedValue(1);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([
      {
        id: "1",
        handle: "@example",
        platform: "instagram",
        niche: "couple vlog",
        emails: [{ address: "a@example.com", validationResult: { confidenceScore: 0.9 } }],
      },
    ]);

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.items[0].email).toBe("a@example.com");
    expect(res.body.items[0].confidenceScore).toBe(0.9);
  });

  it("clamps pageSize to the max of 100", async () => {
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").set("X-API-Key", TEST_API_KEY).query({ pageSize: 500 });

    expect(res.body.pageSize).toBe(100);
  });

  it("rejects an invalid page value", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/creators")
      .set("X-API-Key", TEST_API_KEY)
      .query({ page: "not-a-number" });

    expect(res.status).toBe(400);
  });

  it("rejects an unsupported platform filter", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/creators")
      .set("X-API-Key", TEST_API_KEY)
      .query({ platform: "mastodon" });

    expect(res.status).toBe(400);
  });

  it("never selects with an unbounded query (filters passed through to where)", async () => {
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

    const { app } = buildTestApp();
    await request(app).get("/api/v1/creators").set("X-API-Key", TEST_API_KEY).query({ niche: "couple vlog" });

    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { niche: "couple vlog" } })
    );
  });
});

describe("GET /api/v1/creators/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns full creator detail including bio/socialLinks", async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      handle: "@example",
      platform: "instagram",
      niche: "couple vlog",
      websiteUrl: "https://instagram.com/example",
      bio: "We are a couple who loves to travel.",
      socialLinks: ["https://instagram.com/example", "https://youtube.com/example"],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      emails: [
        {
          address: "a@example.com",
          validationResult: { isValid: true, confidenceScore: 0.9, reasons: ["syntax_ok", "mx_ok"] },
        },
      ],
    });

    const { app } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/creators/11111111-1111-1111-1111-111111111111")
      .set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("We are a couple who loves to travel.");
    expect(res.body.socialLinks).toEqual(["https://instagram.com/example", "https://youtube.com/example"]);
    expect(res.body.email).toBe("a@example.com");
    expect(res.body.confidenceScore).toBe(0.9);
  });

  it("returns 404 for an unknown id", async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

    const { app } = buildTestApp();
    const res = await request(app)
      .get("/api/v1/creators/11111111-1111-1111-1111-111111111111")
      .set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("rejects a non-uuid id", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators/not-a-uuid").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(400);
  });
});
