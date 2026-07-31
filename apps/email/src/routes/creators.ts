import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { creatorIdParamSchema } from "../validation";

// Added for apps/admin (Sprint 5)'s Creator Detail "Campaign History" tab --
// there was previously no way to look up which campaigns a given creator has
// been part of (campaign_recipients has no query-by-creatorId endpoint).
// Read-only; does not join to apps/backend's own creator record (that comes
// from GET apps/backend /api/v1/creators/:id separately).
export const creatorsRouter = Router();

creatorsRouter.get(
  "/creators/:creatorId/campaign-history",
  asyncHandler(async (req, res) => {
    const parsed = creatorIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid creator id", parsed.error.issues);
    }

    const recipients = await prisma.campaignRecipient.findMany({
      where: { creatorId: parsed.data.creatorId },
      orderBy: { createdAt: "desc" },
      include: { campaign: { select: { id: true, name: true, status: true } } },
    });

    res.json({
      items: recipients.map((r) => ({
        campaignId: r.campaign.id,
        campaignName: r.campaign.name,
        campaignStatus: r.campaign.status,
        recipientStatus: r.status,
        email: r.email,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      })),
    });
  })
);
