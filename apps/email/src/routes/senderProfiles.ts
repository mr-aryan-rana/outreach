import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { createSenderProfileSchema } from "../validation";

// Not in the Sprint 4 endpoint list verbatim, but structurally required --
// campaigns reference a senderProfileId and there is no other way to create
// one. Same "small, necessary, additive endpoint" precedent as
// GET /creators/:id (apps/backend, RC1) and GET /ai/drafts/:id (apps/ai,
// this sprint).
export const senderProfilesRouter = Router();

senderProfilesRouter.post(
  "/sender-profiles",
  asyncHandler(async (req, res) => {
    const parsed = createSenderProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    const profile = await prisma.senderProfile.create({ data: parsed.data });
    res.status(201).json(profile);
  })
);

senderProfilesRouter.get(
  "/sender-profiles",
  asyncHandler(async (_req, res) => {
    const profiles = await prisma.senderProfile.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ items: profiles });
  })
);
