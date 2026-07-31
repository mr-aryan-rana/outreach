import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { enqueueSend, getEmailSendDlq, getEmailSendQueue } from "../queue/emailQueue";
import { dlqJobIdParamSchema } from "../validation";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/dashboard/campaigns",
  asyncHandler(async (_req, res) => {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, status: true, createdAt: true, sendStartedAt: true, completedAt: true },
    });
    res.json({ items: campaigns });
  })
);

dashboardRouter.get(
  "/dashboard/queue",
  asyncHandler(async (_req, res) => {
    const queue = getEmailSendQueue();
    const dlq = getEmailSendDlq();
    const [waiting, active, delayed, failed, completed, dlqCount] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
      dlq.getWaitingCount(),
    ]);
    res.json({ waiting, active, delayed, failed, completed, deadLetter: dlqCount });
  })
);

dashboardRouter.get(
  "/dashboard/providers",
  asyncHandler(async (_req, res) => {
    const recentLogs = await prisma.emailProviderLog.groupBy({
      by: ["provider", "responseStatus"],
      _count: { _all: true },
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    const byProvider: Record<string, { success: number; error: number }> = {};
    for (const row of recentLogs) {
      byProvider[row.provider] ??= { success: 0, error: 0 };
      if (row.responseStatus === "success") byProvider[row.provider].success = row._count._all;
      else byProvider[row.provider].error = row._count._all;
    }
    res.json({ last24h: byProvider });
  })
);

/**
 * Added for apps/admin (Sprint 5)'s Queue page: dashboard/queue only gives
 * counts, not which jobs are actually dead-lettered -- needed so the "Retry"
 * action has an actual job id to act on, and so an operator can see why a
 * job died before deciding to retry it.
 */
dashboardRouter.get(
  "/dashboard/queue/dlq",
  asyncHandler(async (_req, res) => {
    const dlq = getEmailSendDlq();
    const jobs = await dlq.getJobs(["waiting", "delayed"], 0, 100);
    const recipientIds = jobs.map((j) => (j.data as { campaignRecipientId: string }).campaignRecipientId);
    const recipients = await prisma.campaignRecipient.findMany({
      where: { id: { in: recipientIds } },
      include: { campaign: { select: { id: true, name: true } } },
    });
    const recipientById = new Map(recipients.map((r) => [r.id, r]));

    res.json({
      items: jobs.map((j) => {
        const recipientId = (j.data as { campaignRecipientId: string }).campaignRecipientId;
        const recipient = recipientById.get(recipientId);
        return {
          jobId: j.id,
          campaignRecipientId: recipientId,
          email: recipient?.email ?? null,
          campaignId: recipient?.campaign.id ?? null,
          campaignName: recipient?.campaign.name ?? null,
          failedReason: j.failedReason ?? null,
          timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
        };
      }),
    });
  })
);

/**
 * Added for apps/admin (Sprint 5)'s Queue page "Retry" action. Dead-lettered
 * jobs (see queue/worker.ts handleJobFailed(), moved here after exhausting
 * every BullMQ retry attempt) have no automatic reprocessing -- a human
 * decides whether the underlying cause (bad credentials, provider outage,
 * transient network issue) has actually been fixed before replaying. Removes
 * the job from the DLQ, resets the recipient to "queued", and re-enqueues it
 * as a fresh send with a full new attempt budget.
 */
dashboardRouter.post(
  "/dashboard/queue/dlq/:jobId/retry",
  asyncHandler(async (req, res) => {
    const parsed = dlqJobIdParamSchema.safeParse(req.params);
    if (!parsed.success) return sendError(req, res, 400, "invalid_query", "invalid job id");

    const dlq = getEmailSendDlq();
    const job = await dlq.getJob(parsed.data.jobId);
    if (!job) return sendError(req, res, 404, "not_found", `no dead-lettered job with id ${parsed.data.jobId}`);

    const { campaignRecipientId } = job.data as { campaignRecipientId: string };
    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: campaignRecipientId } });
    if (!recipient) return sendError(req, res, 404, "not_found", "recipient for this job no longer exists");

    await job.remove();
    const newJob = await enqueueSend(campaignRecipientId);
    await prisma.campaignRecipient.update({
      where: { id: campaignRecipientId },
      data: { status: "queued", queueJobId: newJob.id },
    });

    res.json({ campaignRecipientId, requeued: true, jobId: newJob.id });
  })
);

/**
 * Bounce/reply/failure rate over each campaign's actually-sent recipients
 * (status not in pending/queued -- an in-flight campaign's rate is
 * meaningless/misleading until sending has actually happened).
 */
dashboardRouter.get(
  "/dashboard/rates",
  asyncHandler(async (req, res) => {
    const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : undefined;
    const where = campaignId ? { campaignId } : {};

    const [total, bounced, replied, failed] = await Promise.all([
      prisma.campaignRecipient.count({ where: { ...where, status: { notIn: ["pending", "queued", "suppressed"] } } }),
      prisma.campaignRecipient.count({ where: { ...where, status: "bounced" } }),
      prisma.campaignRecipient.count({ where: { ...where, status: "replied" } }),
      prisma.campaignRecipient.count({ where: { ...where, status: "failed" } }),
    ]);

    const rate = (n: number) => (total > 0 ? Number((n / total).toFixed(4)) : 0);
    res.json({
      campaignId: campaignId ?? "all",
      totalSent: total,
      bounceRate: rate(bounced),
      replyRate: rate(replied),
      failureRate: rate(failed),
    });
  })
);
