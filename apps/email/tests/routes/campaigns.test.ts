jest.mock("../../src/db", () => ({
  prisma: {
    campaign: { findUnique: jest.fn() },
    campaignRecipient: { groupBy: jest.fn() },
  },
}));

jest.mock("../../src/services/campaignService", () => ({
  ...jest.requireActual("../../src/services/campaignService"),
  createCampaign: jest.fn(),
  approveCampaign: jest.fn(),
  sendCampaign: jest.fn(),
  pauseCampaign: jest.fn(),
  resumeCampaign: jest.fn(),
}));

import request from "supertest";
import { prisma } from "../../src/db";
import {
  approveCampaign,
  createCampaign,
  InvalidStateTransitionError,
  pauseCampaign,
  resumeCampaign,
  sendCampaign,
} from "../../src/services/campaignService";
import { buildTestApp, TEST_API_KEY } from "../testApp";

const CAMPAIGN_ID = "11111111-1111-1111-1111-111111111111";
const SENDER_ID = "22222222-2222-2222-2222-222222222222";

describe("POST /api/v1/campaigns", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects requests without a valid API key", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/campaigns").send({});
    expect(res.status).toBe(401);
  });

  it("rejects an empty recipient list", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("X-API-Key", TEST_API_KEY)
      .send({ name: "Test", senderProfileId: SENDER_ID, recipients: [] });
    expect(res.status).toBe(400);
  });

  it("creates a campaign given valid recipients", async () => {
    (createCampaign as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "pending_review" });
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("X-API-Key", TEST_API_KEY)
      .send({
        name: "Test",
        senderProfileId: SENDER_ID,
        recipients: [{ creatorId: "33333333-3333-3333-3333-333333333333", draftEmailId: "44444444-4444-4444-4444-444444444444", email: "a@example.com" }],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending_review");
  });
});

describe("POST /api/v1/campaigns/:id/approve", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 409 for an invalid state transition", async () => {
    (approveCampaign as jest.Mock).mockRejectedValue(new InvalidStateTransitionError("approved", "approve"));
    const { app } = buildTestApp();
    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_ID}/approve`)
      .set("X-API-Key", TEST_API_KEY)
      .send({ approvedBy: "reviewer" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("invalid_state_transition");
  });

  it("approves given a valid transition", async () => {
    (approveCampaign as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "approved" });
    const { app } = buildTestApp();
    const res = await request(app)
      .post(`/api/v1/campaigns/${CAMPAIGN_ID}/approve`)
      .set("X-API-Key", TEST_API_KEY)
      .send({ approvedBy: "reviewer" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
  });
});

describe("POST /api/v1/campaigns/:id/send -- Sending Rules gate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses to send an unapproved campaign with 409, not 200", async () => {
    (sendCampaign as jest.Mock).mockRejectedValue(new InvalidStateTransitionError("pending_review", "send"));
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/send`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("invalid_state_transition");
  });

  it("sends an approved campaign", async () => {
    (sendCampaign as jest.Mock).mockResolvedValue({ campaignId: CAMPAIGN_ID, enqueued: 3 });
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/send`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.enqueued).toBe(3);
  });
});

describe("POST /api/v1/campaigns/:id/pause and /resume", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 409 for pausing a campaign not currently queued/sending", async () => {
    (pauseCampaign as jest.Mock).mockRejectedValue(new InvalidStateTransitionError("approved", "pause"));
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/pause`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(409);
  });

  it("pauses a sending campaign", async () => {
    (pauseCampaign as jest.Mock).mockResolvedValue({ campaign: { id: CAMPAIGN_ID, status: "paused" }, dequeued: 2, stillInFlight: 0 });
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/pause`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.dequeued).toBe(2);
  });

  it("returns 409 for resuming a campaign that isn't paused", async () => {
    (resumeCampaign as jest.Mock).mockRejectedValue(new InvalidStateTransitionError("queued", "resume"));
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/resume`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(409);
  });

  it("resumes a paused campaign", async () => {
    (resumeCampaign as jest.Mock).mockResolvedValue({ campaignId: CAMPAIGN_ID, enqueued: 4 });
    const { app } = buildTestApp();
    const res = await request(app).post(`/api/v1/campaigns/${CAMPAIGN_ID}/resume`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.enqueued).toBe(4);
  });
});

describe("GET /api/v1/campaigns/:id/status", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 404 for an unknown campaign", async () => {
    (prisma.campaign.findUnique as jest.Mock).mockResolvedValue(null);
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_ID}/status`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(404);
  });

  it("returns status + recipient counts by status", async () => {
    (prisma.campaign.findUnique as jest.Mock).mockResolvedValue({
      id: CAMPAIGN_ID,
      name: "Test",
      status: "sending",
      approvedBy: "reviewer",
      approvedAt: new Date(),
      sendStartedAt: new Date(),
      completedAt: null,
    });
    (prisma.campaignRecipient.groupBy as jest.Mock).mockResolvedValue([
      { status: "sent", _count: { status: 5 } },
      { status: "failed", _count: { status: 1 } },
    ]);
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/campaigns/${CAMPAIGN_ID}/status`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.recipientCounts).toEqual({ sent: 5, failed: 1 });
  });
});
