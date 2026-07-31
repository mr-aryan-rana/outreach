jest.mock("../../src/db", () => ({
  prisma: {
    campaign: { create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    campaignRecipient: { createMany: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    suppressionEntry: { findMany: jest.fn() },
  },
}));

jest.mock("../../src/queue/emailQueue", () => ({
  enqueueSend: jest.fn(),
  getEmailSendQueue: jest.fn(),
}));

import { prisma } from "../../src/db";
import { enqueueSend, getEmailSendQueue } from "../../src/queue/emailQueue";
import {
  approveCampaign,
  createCampaign,
  InvalidStateTransitionError,
  pauseCampaign,
  resumeCampaign,
  sendCampaign,
} from "../../src/services/campaignService";

const CAMPAIGN_ID = "c1";

describe("createCampaign", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates pending recipients and marks suppressed ones", async () => {
    (prisma.campaign.create as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID });
    (prisma.suppressionEntry.findMany as jest.Mock).mockResolvedValue([{ email: "bad@example.com" }]);
    (prisma.campaignRecipient.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, recipients: [] });

    await createCampaign({
      name: "Test",
      senderProfileId: "sp1",
      recipients: [
        { creatorId: "cr1", draftEmailId: "d1", email: "good@example.com" },
        { creatorId: "cr2", draftEmailId: "d2", email: "bad@example.com" },
      ],
    });

    expect(prisma.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ email: "good@example.com", status: "pending" }),
        expect.objectContaining({ email: "bad@example.com", status: "suppressed" }),
      ],
    });
  });

  it("de-duplicates the same email appearing twice in one request", async () => {
    (prisma.campaign.create as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID });
    (prisma.suppressionEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.campaignRecipient.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, recipients: [] });

    await createCampaign({
      name: "Test",
      senderProfileId: "sp1",
      recipients: [
        { creatorId: "cr1", draftEmailId: "d1", email: "dupe@example.com" },
        { creatorId: "cr1", draftEmailId: "d1", email: "DUPE@example.com" }, // case-insensitive dupe
      ],
    });

    const call = (prisma.campaignRecipient.createMany as jest.Mock).mock.calls[0][0];
    expect(call.data).toHaveLength(1);
  });

  it("new campaigns start in pending_review, not draft or approved", async () => {
    (prisma.campaign.create as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID });
    (prisma.suppressionEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.campaignRecipient.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID });

    await createCampaign({ name: "Test", senderProfileId: "sp1", recipients: [{ creatorId: "cr1", draftEmailId: "d1", email: "a@example.com" }] });

    expect(prisma.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending_review" }) })
    );
  });
});

describe("approveCampaign", () => {
  beforeEach(() => jest.clearAllMocks());

  it("approves a pending_review campaign", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "pending_review" });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "approved" });

    const result = await approveCampaign(CAMPAIGN_ID, "reviewer@makeable.test");
    expect(result.status).toBe("approved");
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved", approvedBy: "reviewer@makeable.test" }) })
    );
  });

  it("refuses to approve a campaign that isn't pending_review", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "approved" });
    await expect(approveCampaign(CAMPAIGN_ID, "x")).rejects.toThrow(InvalidStateTransitionError);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });
});

describe("sendCampaign -- the core 'never send without approval' gate", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["draft", "pending_review", "queued", "sending", "completed"])(
    "refuses to send a campaign in status %s",
    async (status) => {
      (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status });
      await expect(sendCampaign(CAMPAIGN_ID)).rejects.toThrow(InvalidStateTransitionError);
      expect(enqueueSend).not.toHaveBeenCalled();
    }
  );

  it("enqueues every pending recipient once approved, and only once", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "approved" });
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "r1", createdAt: new Date() },
      { id: "r2", createdAt: new Date() },
    ]);
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.campaignRecipient.update as jest.Mock).mockResolvedValue({});
    (enqueueSend as jest.Mock).mockResolvedValue({ id: "job1" });

    const result = await sendCampaign(CAMPAIGN_ID);

    expect(result.enqueued).toBe(2);
    expect(enqueueSend).toHaveBeenCalledTimes(2);
    // Sending Rules: "one active send per recipient per campaign" -- only
    // ever queries status: "pending" recipients, never re-enqueues
    // already-queued/sent/suppressed ones.
    expect(prisma.campaignRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: CAMPAIGN_ID, status: "pending" } })
    );
  });

  it("spaces recipients apart with increasing delay, not all at once", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "approved" });
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "r1", createdAt: new Date() },
      { id: "r2", createdAt: new Date() },
    ]);
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.campaignRecipient.update as jest.Mock).mockResolvedValue({});
    (enqueueSend as jest.Mock).mockResolvedValue({ id: "job1" });

    await sendCampaign(CAMPAIGN_ID);

    const [firstCallArgs, secondCallArgs] = (enqueueSend as jest.Mock).mock.calls;
    expect(firstCallArgs[1].delayMs).toBeGreaterThan(0);
    expect(secondCallArgs[1].delayMs).toBeGreaterThan(firstCallArgs[1].delayMs);
  });
});

describe("pauseCampaign", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["draft", "pending_review", "approved", "paused", "completed"])(
    "refuses to pause a campaign in status %s",
    async (status) => {
      (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status });
      await expect(pauseCampaign(CAMPAIGN_ID)).rejects.toThrow(InvalidStateTransitionError);
    }
  );

  it("removes not-yet-active queued jobs and leaves active ones alone", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "queued" });
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "r1", queueJobId: "job1" },
      { id: "r2", queueJobId: "job2" },
    ]);
    const removableJob = { getState: jest.fn().mockResolvedValue("delayed"), remove: jest.fn().mockResolvedValue(undefined) };
    const activeJob = { getState: jest.fn().mockResolvedValue("active"), remove: jest.fn().mockResolvedValue(undefined) };
    (getEmailSendQueue as jest.Mock).mockReturnValue({
      getJob: jest.fn().mockImplementation((id: string) => (id === "job1" ? removableJob : activeJob)),
    });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "paused" });

    const result = await pauseCampaign(CAMPAIGN_ID);

    expect(removableJob.remove).toHaveBeenCalled();
    expect(activeJob.remove).not.toHaveBeenCalled();
    expect(result.dequeued).toBe(1);
    expect(result.stillInFlight).toBe(1);
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "paused" } })
    );
  });
});

describe("resumeCampaign", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["draft", "pending_review", "approved", "queued", "sending", "completed"])(
    "refuses to resume a campaign in status %s",
    async (status) => {
      (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status });
      await expect(resumeCampaign(CAMPAIGN_ID)).rejects.toThrow(InvalidStateTransitionError);
      expect(enqueueSend).not.toHaveBeenCalled();
    }
  );

  it("re-enqueues every still-queued recipient", async () => {
    (prisma.campaign.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: CAMPAIGN_ID, status: "paused" });
    (prisma.campaignRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "r1", createdAt: new Date() },
    ]);
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.campaignRecipient.update as jest.Mock).mockResolvedValue({});
    (enqueueSend as jest.Mock).mockResolvedValue({ id: "job3" });

    const result = await resumeCampaign(CAMPAIGN_ID);

    expect(result.enqueued).toBe(1);
    expect(prisma.campaignRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: CAMPAIGN_ID, status: "queued" } })
    );
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "queued" } })
    );
  });
});
