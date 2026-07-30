import { Job, Worker } from "bullmq";
import { env } from "../config/env";
import { prisma } from "../db";
import { logger } from "../logger";
import { fetchDraft } from "../services/aiClient";
import { emailEventsTotal, queueJobsTotal } from "../services/metrics";
import { sendViaProvider } from "../providers/registry";
import { EmailSendError } from "../providers/types";
import { createQueueConnection } from "./connection";
import { EMAIL_SEND_QUEUE, EmailSendJobData, getEmailSendDlq } from "./emailQueue";

async function recordEvent(
  campaignRecipientId: string,
  eventType: string,
  metadata?: unknown,
  providerMessageId?: string
) {
  emailEventsTotal.labels(eventType).inc();
  await prisma.emailEvent.create({
    data: { campaignRecipientId, eventType, metadata: metadata as any, providerMessageId },
  });
}

/**
 * The only place an actual provider send call happens. Re-checks
 * suppression and campaign approval status immediately before sending --
 * both can have changed since the recipient was enqueued (an unsubscribe
 * webhook, an operator suppressing an address, or -- defensively, should
 * never happen given sendCampaign()'s own guard -- a campaign somehow no
 * longer being "approved"/"queued"/"sending").
 */
export async function processSendJob(job: Job<EmailSendJobData>): Promise<void> {
  const recipient = await prisma.campaignRecipient.findUniqueOrThrow({
    where: { id: job.data.campaignRecipientId },
    include: { campaign: { include: { senderProfile: true } } },
  });

  if (!["approved", "queued", "sending"].includes(recipient.campaign.status)) {
    logger.warn({ event: "send_skipped_campaign_not_approved", campaignId: recipient.campaignId, status: recipient.campaign.status });
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "failed" } });
    await recordEvent(recipient.id, "failed", { reason: "campaign not in a sendable state" });
    return;
  }

  const stillSuppressed = await prisma.suppressionEntry.findUnique({ where: { email: recipient.email } });
  if (stillSuppressed) {
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "suppressed" } });
    await recordEvent(recipient.id, "failed", { reason: "suppressed after enqueue", suppressionReason: stillSuppressed.reason });
    return;
  }

  if (recipient.campaign.status === "approved" || recipient.campaign.status === "queued") {
    await prisma.campaign.update({ where: { id: recipient.campaignId }, data: { status: "sending" } });
  }

  const draft = await fetchDraft(recipient.draftEmailId, job.id);
  const sender = recipient.campaign.senderProfile;

  const start = process.hrtime.bigint();
  try {
    const result = await sendViaProvider(sender.provider, {
      to: recipient.email,
      from: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: sender.replyTo ?? undefined,
      subject: draft.subject,
      body: draft.body,
    });
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;

    await prisma.$transaction([
      prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "sent", sentAt: new Date() } }),
      prisma.emailProviderLog.create({
        data: {
          campaignRecipientId: recipient.id,
          provider: sender.provider,
          requestSummary: { to: recipient.email, subject: draft.subject } as any,
          responseStatus: "success",
          responseBody: { providerMessageId: result.providerMessageId } as any,
          latencyMs: Math.round(latencyMs),
        },
      }),
    ]);
    await recordEvent(recipient.id, "sent", { providerMessageId: result.providerMessageId }, result.providerMessageId);
  } catch (err) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    await prisma.emailProviderLog.create({
      data: {
        campaignRecipientId: recipient.id,
        provider: sender.provider,
        requestSummary: { to: recipient.email, subject: draft.subject } as any,
        responseStatus: "error",
        responseBody: { message: (err as Error).message } as any,
        latencyMs: Math.round(latencyMs),
      },
    });
    throw err; // let BullMQ's retry/backoff handle it -- see queue/emailQueue.ts attempts config
  }
}

export function startEmailWorker(): Worker<EmailSendJobData> {
  const worker = new Worker<EmailSendJobData>(EMAIL_SEND_QUEUE, processSendJob, {
    connection: createQueueConnection(),
    concurrency: env.queueConcurrency,
  });

  worker.on("completed", () => queueJobsTotal.labels("completed").inc());
  worker.on("failed", (job, err) => handleJobFailed(job, err));

  return worker;
}

/**
 * Extracted from the Worker's "failed" listener so it's unit-testable
 * without needing a real BullMQ Worker/Redis connection -- see
 * tests/queue/worker.test.ts "failure recovery".
 */
export async function handleJobFailed(job: Job<EmailSendJobData> | undefined, err: Error): Promise<void> {
  if (!job) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  queueJobsTotal.labels("failed").inc();

  if (!exhausted) {
    logger.warn({ event: "send_job_failed_will_retry", jobId: job.id, attempt: job.attemptsMade, error: err.message });
    return;
  }

  // Requirement #2's Dead Letter Queue: exhausted every retry attempt --
  // move it to the dedicated DLQ and mark the recipient failed so it's
  // visible via GET /campaigns/:id/status without needing to inspect the
  // queue directly.
  logger.error({ event: "send_job_dead_letter", jobId: job.id, error: err.message });
  queueJobsTotal.labels("dead_letter").inc();
  await getEmailSendDlq().add("dead-letter", job.data, { removeOnComplete: false });

  const retryable = err instanceof EmailSendError ? err.retryable : true;
  await prisma.campaignRecipient
    .update({ where: { id: job.data.campaignRecipientId }, data: { status: "failed" } })
    .catch(() => undefined);
  await recordEvent(job.data.campaignRecipientId, "failed", { error: err.message, retryable }).catch(() => undefined);
}
