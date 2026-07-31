jest.mock("../../src/db", () => ({
  prisma: {
    campaignRecipient: { findMany: jest.fn() },
  },
}));

import request from "supertest";
import { prisma } from "../../src/db";
import { buildTestApp, TEST_API_KEY } from "../testApp";

const CREATOR_ID = "11111111-1111-1111-1111-111111111111";

describe("GET /api/v1/creators/:creatorId/campaign-history", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a non-uuid creator id", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/creators/not-a-uuid/campaign-history").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(400);
  });

  it("returns campaign history joined with campaign name/status", async () => {
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      {
        campaign: { id: "c1", name: "Q3 Outreach", status: "sending" },
        status: "sent",
        email: "creator@example.com",
        sentAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const { app } = buildTestApp();
    const res = await request(app)
      .get(`/api/v1/creators/${CREATOR_ID}/campaign-history`)
      .set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ campaignId: "c1", campaignName: "Q3 Outreach", recipientStatus: "sent" });
  });
});
