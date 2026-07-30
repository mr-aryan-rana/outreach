import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { prisma } from "../db";
import { getEmailSendDlq, getEmailSendQueue } from "../queue/emailQueue";

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
