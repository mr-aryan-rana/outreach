import request from "supertest";

jest.mock("../src/db", () => ({
  prisma: {
    creator: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "../src/db";
import { buildTestApp } from "./testApp";

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
    const res = await request(app).get("/api/v1/creators");

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
    const res = await request(app).get("/api/v1/creators").query({ pageSize: 500 });

    expect(res.body.pageSize).toBe(100);
  });

  it("rejects an invalid page value", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").query({ page: "not-a-number" });

    expect(res.status).toBe(400);
  });

  it("rejects an unsupported platform filter", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators").query({ platform: "mastodon" });

    expect(res.status).toBe(400);
  });

  it("never selects with an unbounded query (filters passed through to where)", async () => {
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

    const { app } = buildTestApp();
    await request(app).get("/api/v1/creators").query({ niche: "couple vlog" });

    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { niche: "couple vlog" } })
    );
  });
});
