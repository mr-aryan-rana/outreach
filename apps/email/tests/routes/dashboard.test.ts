jest.mock("../../src/db", () => ({
  prisma: {
    campaignRecipient: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("../../src/queue/emailQueue", () => ({
  enqueueSend: jest.fn(),
  getEmailSendDlq: jest.fn(),
  getEmailSendQueue: jest.fn(),
}));

import request from "supertest";
import { prisma } from "../../src/db";
import { enqueueSend, getEmailSendDlq } from "../../src/queue/emailQueue";
import { buildTestApp, TEST_API_KEY } from "../testApp";

describe("GET /api/v1/dashboard/queue/dlq", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists dead-lettered jobs joined with recipient/campaign info", async () => {
    (getEmailSendDlq as jest.Mock).mockReturnValue({
      getJobs: jest.fn().mockResolvedValue([
        { id: "job1", data: { campaignRecipientId: "r1" }, failedReason: "SMTP down", timestamp: 1700000000000 },
      ]),
    });
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "r1", email: "a@example.com", campaign: { id: "c1", name: "Q3 Outreach" } },
    ]);

    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/dashboard/queue/dlq").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      jobId: "job1",
      email: "a@example.com",
      campaignName: "Q3 Outreach",
      failedReason: "SMTP down",
    });
  });
});

describe("POST /api/v1/dashboard/queue/dlq/:jobId/retry", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 404 when the dead-lettered job doesn't exist", async () => {
    (getEmailSendDlq as jest.Mock).mockReturnValue({ getJob: jest.fn().mockResolvedValue(undefined) });
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/dashboard/queue/dlq/job1/retry").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(404);
  });

  it("removes the job from the DLQ and re-enqueues a fresh send", async () => {
    const removeMock = jest.fn().mockResolvedValue(undefined);
    (getEmailSendDlq as jest.Mock).mockReturnValue({
      getJob: jest.fn().mockResolvedValue({ data: { campaignRecipientId: "r1" }, remove: removeMock }),
    });
    (prisma.campaignRecipient.findUnique as jest.Mock).mockResolvedValue({ id: "r1" });
    (enqueueSend as jest.Mock).mockResolvedValue({ id: "job-new" });
    (prisma.campaignRecipient.update as jest.Mock).mockResolvedValue({});

    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/dashboard/queue/dlq/job1/retry").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalled();
    expect(enqueueSend).toHaveBeenCalledWith("r1");
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: { status: "queued", queueJobId: "job-new" } })
    );
  });
});
