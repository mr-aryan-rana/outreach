import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { campaignIdParamSchema, suppressionEntrySchema } from "../validation";

// Not in the Sprint 4 endpoint list verbatim, but the "Respect suppression
// lists" Sending Rule has nowhere to originate manual suppressions
// (unsubscribe requests, manual compliance holds) without one. Automatic
// suppression on bounce/complaint happens via routes/webhooks.ts instead.
export const suppressionRouter = Router();

suppressionRouter.post(
  "/suppression",
  asyncHandler(async (req, res) => {
    const parsed = suppressionEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    const entry = await prisma.suppressionEntry.upsert({
      where: { email: parsed.data.email.toLowerCase() },
      create: { ...parsed.data, email: parsed.data.email.toLowerCase() },
      update: { reason: parsed.data.reason, source: parsed.data.source },
    });
    res.status(201).json(entry);
  })
);

suppressionRouter.get(
  "/suppression",
  asyncHandler(async (_req, res) => {
    const entries = await prisma.suppressionEntry.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    res.json({ items: entries });
  })
);

// Manual "replied" marking -- explicitly NOT automated (Sprint 4 rule: "No
// reply automation"). A human (or an external tool a human operates)
// reports that a recipient replied; this service never inspects an inbox or
// triggers any action from a reply itself.
suppressionRouter.post(
  "/campaigns/:id/recipients/:recipientId/mark-replied",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");

    const recipient = await prisma.campaignRecipient.findFirst({
      where: { id: req.params.recipientId, campaignId: idParsed.data.id },
    });
    if (!recipient) return sendError(req, res, 404, "not_found", "no such campaign recipient");

    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "replied" } });
    await prisma.emailEvent.create({
      data: { campaignRecipientId: recipient.id, eventType: "replied", metadata: { markedBy: "manual" } },
    });
    res.json({ ok: true });
  })
);
