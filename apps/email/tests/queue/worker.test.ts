jest.mock("../../src/db", () => ({
  prisma: {
    campaignRecipient: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    suppressionEntry: { findUnique: jest.fn() },
    campaign: { update: jest.fn() },
    emailEvent: { create: jest.fn() },
    emailProviderLog: { create: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

jest.mock("../../src/services/aiClient", () => ({
  fetchDraft: jest.fn(),
}));

jest.mock("../../src/providers/registry", () => ({
  sendViaProvider: jest.fn(),
}));

jest.mock("../../src/queue/emailQueue", () => ({
  ...jest.requireActual("../../src/queue/emailQueue"),
  getEmailSendDlq: jest.fn(),
}));

import { prisma } from "../../src/db";
import { fetchDraft } from "../../src/services/aiClient";
import { sendViaProvider } from "../../src/providers/registry";
import { getEmailSendDlq } from "../../src/queue/emailQueue";
import { EmailSendError } from "../../src/providers/types";
import { handleJobFailed, processSendJob } from "../../src/queue/worker";

const RECIPIENT = {
  id: "r1",
  campaignId: "c1",
  draftEmailId: "d1",
  email: "creator@example.com",
  campaign: {
    id: "c1",
    status: "queued",
    senderProfile: { provider: "mock", fromEmail: "brand@makeable.test", fromName: "Brand", replyTo: null },
  },
};

describe("processSendJob", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends via the provider and marks the recipient sent", async () => {
    (prisma.campaignRecipient.findUniqueOrThrow as jest.Mock).mockResolvedValue(RECIPIENT);
    (prisma.suppressionEntry.findUnique as jest.Mock).mockResolvedValue(null);
    (fetchDraft as jest.Mock).mockResolvedValue({ id: "d1", subject: "Hi", body: "Hello" });
    (sendViaProvider as jest.Mock).mockResolvedValue({ providerMessageId: "mock-123" });

    await processSendJob({ data: { campaignRecipientId: "r1" }, id: "job1" } as any);

    expect(sendViaProvider).toHaveBeenCalledWith(
      "mock",
      expect.objectContaining({ to: "creator@example.com", subject: "Hi", body: "Hello" })
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    // Regression: the "sent" event used to only bury providerMessageId in
    // `metadata`, leaving the dedicated (indexed, webhook-matchable) column
    // null -- found live while manually verifying a real campaign send.
    expect(prisma.emailEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "sent", providerMessageId: "mock-123" }) })
    );
  });

  it("re-checks suppression at send time and refuses to send if suppressed since enqueue", async () => {
    (prisma.campaignRecipient.findUniqueOrThrow as jest.Mock).mockResolvedValue(RECIPIENT);
    (prisma.suppressionEntry.findUnique as jest.Mock).mockResolvedValue({ email: "creator@example.com", reason: "unsubscribed" });

    await processSendJob({ data: { campaignRecipientId: "r1" }, id: "job1" } as any);

    expect(sendViaProvider).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "suppressed" } })
    );
  });

  it("refuses to send if the campaign is somehow no longer in a sendable state", async () => {
    (prisma.campaignRecipient.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      ...RECIPIENT,
      campaign: { ...RECIPIENT.campaign, status: "pending_review" },
    });

    await processSendJob({ data: { campaignRecipientId: "r1" }, id: "job1" } as any);

    expect(sendViaProvider).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed" } }));
  });

  it("logs a provider_log entry and rethrows on send failure (so BullMQ retries)", async () => {
    (prisma.campaignRecipient.findUniqueOrThrow as jest.Mock).mockResolvedValue(RECIPIENT);
    (prisma.suppressionEntry.findUnique as jest.Mock).mockResolvedValue(null);
    (fetchDraft as jest.Mock).mockResolvedValue({ id: "d1", subject: "Hi", body: "Hello" });
    (sendViaProvider as jest.Mock).mockRejectedValue(new EmailSendError("SMTP down", "smtp", true));

    await expect(processSendJob({ data: { campaignRecipientId: "r1" }, id: "job1" } as any)).rejects.toThrow("SMTP down");
    expect(prisma.emailProviderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ responseStatus: "error" }) })
    );
  });
});

describe("handleJobFailed (failure recovery / dead letter queue)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getEmailSendDlq as jest.Mock).mockReturnValue({ add: jest.fn().mockResolvedValue({}) });
  });

  it("does nothing but log when attempts are not yet exhausted (still retrying)", async () => {
    const job = { id: "job1", data: { campaignRecipientId: "r1" }, attemptsMade: 1, opts: { attempts: 3 } } as any;
    await handleJobFailed(job, new Error("transient"));

    expect(getEmailSendDlq).not.toHaveBeenCalled();
    expect(prisma.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it("moves an exhausted job to the DLQ and marks the recipient failed", async () => {
    const job = { id: "job1", data: { campaignRecipientId: "r1" }, attemptsMade: 3, opts: { attempts: 3 } } as any;
    (prisma.campaignRecipient.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});

    await handleJobFailed(job, new Error("permanent failure"));

    expect(getEmailSendDlq().add).toHaveBeenCalledWith("dead-letter", job.data, expect.anything());
    expect(prisma.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: { status: "failed" } })
    );
  });

  it("does nothing if there is no job (BullMQ can call the failed handler with an undefined job)", async () => {
    await handleJobFailed(undefined, new Error("x"));
    expect(getEmailSendDlq).not.toHaveBeenCalled();
  });
});
