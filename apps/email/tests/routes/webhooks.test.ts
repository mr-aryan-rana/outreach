jest.mock("../../src/db", () => ({
  prisma: {
    emailProviderLog: { findFirst: jest.fn() },
    emailEvent: { create: jest.fn() },
    campaignRecipient: { update: jest.fn(), findUnique: jest.fn() },
    suppressionEntry: { upsert: jest.fn() },
  },
}));

import request from "supertest";
import { prisma } from "../../src/db";
import { buildTestApp } from "../testApp";

describe("POST /api/v1/webhooks/resend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WEBHOOK_SHARED_SECRET;
  });

  it("does not require the campaigns API key -- webhooks use their own auth", async () => {
    (prisma.emailProviderLog.findFirst as jest.Mock).mockResolvedValue(null);
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/webhooks/resend")
      .send({ type: "email.delivered", data: { email_id: "msg1" } });
    expect(res.status).toBe(200); // no X-API-Key header sent, still succeeds
  });

  it("rejects an invalid token when WEBHOOK_SHARED_SECRET is configured", async () => {
    process.env.WEBHOOK_SHARED_SECRET = "secret123";
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/webhooks/resend")
      .send({ type: "email.delivered", data: { email_id: "msg1" } });
    expect(res.status).toBe(401);
  });

  it("records a delivered event and updates recipient status when the message id matches a known send", async () => {
    (prisma.emailProviderLog.findFirst as jest.Mock).mockResolvedValue({ campaignRecipientId: "r1" });
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/webhooks/resend")
      .send({ type: "email.delivered", data: { email_id: "msg1" } });

    expect(res.status).toBe(200);
    expect(prisma.emailEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignRecipientId: "r1", eventType: "delivered" }) })
    );
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: { status: "delivered" } })
    );
  });

  it("auto-suppresses the recipient on a bounce event", async () => {
    (prisma.emailProviderLog.findFirst as jest.Mock).mockResolvedValue({ campaignRecipientId: "r1" });
    (prisma.campaignRecipient.findUnique as jest.Mock).mockResolvedValue({ id: "r1", email: "bouncer@example.com" });
    const { app } = buildTestApp();

    await request(app).post("/api/v1/webhooks/resend").send({ type: "email.bounced", data: { email_id: "msg1" } });

    expect(prisma.suppressionEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "bouncer@example.com" },
        create: expect.objectContaining({ email: "bouncer@example.com", reason: "bounced" }),
      })
    );
  });

  it("ignores an event for an unrecognized message id instead of erroring", async () => {
    (prisma.emailProviderLog.findFirst as jest.Mock).mockResolvedValue(null);
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/webhooks/resend")
      .send({ type: "email.delivered", data: { email_id: "unknown-msg" } });
    expect(res.status).toBe(200);
    expect(prisma.emailEvent.create).not.toHaveBeenCalled();
  });
});
