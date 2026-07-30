import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { emailEventsQuerySchema } from "../validation";

export const emailEventsRouter = Router();

emailEventsRouter.get(
  "/email-events",
  asyncHandler(async (req, res) => {
    const parsed = emailEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid query", parsed.error.issues);
    }
    const { page, pageSize, campaignId, eventType } = parsed.data;

    const where: Record<string, unknown> = {};
    if (eventType) where.eventType = eventType;
    if (campaignId) where.campaignRecipient = { campaignId };

    const [total, events] = await Promise.all([
      prisma.emailEvent.count({ where }),
      prisma.emailEvent.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          eventType: true,
          providerMessageId: true,
          metadata: true,
          occurredAt: true,
          campaignRecipient: { select: { id: true, campaignId: true, email: true } },
        },
      }),
    ]);

    res.json({
      page,
      pageSize,
      total,
      items: events.map((e) => ({
        id: e.id,
        campaignId: e.campaignRecipient.campaignId,
        campaignRecipientId: e.campaignRecipient.id,
        email: e.campaignRecipient.email,
        eventType: e.eventType,
        providerMessageId: e.providerMessageId,
        metadata: e.metadata,
        occurredAt: e.occurredAt,
      })),
    });
  })
);
