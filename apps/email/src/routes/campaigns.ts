import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import {
  approveCampaign,
  createCampaign,
  InvalidStateTransitionError,
  pauseCampaign,
  resumeCampaign,
  sendCampaign,
} from "../services/campaignService";
import { approveCampaignSchema, campaignIdParamSchema, createCampaignSchema } from "../validation";

export const campaignsRouter = Router();

campaignsRouter.post(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    const campaign = await createCampaign(parsed.data);
    res.status(201).json(campaign);
  })
);

campaignsRouter.post(
  "/campaigns/:id/approve",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    const bodyParsed = approveCampaignSchema.safeParse(req.body);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");
    if (!bodyParsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", bodyParsed.error.issues);
    }
    try {
      const campaign = await approveCampaign(idParsed.data.id, bodyParsed.data.approvedBy);
      res.json(campaign);
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        return sendError(req, res, 409, "invalid_state_transition", err.message);
      }
      throw err;
    }
  })
);

// Sending Rules: "Never send AI drafts automatically" / "Human approval
// required" -- sendCampaign() itself refuses anything not already
// "approved" (see services/campaignService.ts), this route just surfaces
// that as a 409 rather than a 500.
campaignsRouter.post(
  "/campaigns/:id/send",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");
    try {
      const result = await sendCampaign(idParsed.data.id);
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        return sendError(req, res, 409, "invalid_state_transition", err.message);
      }
      throw err;
    }
  })
);

// Added for apps/admin (Sprint 5)'s Campaigns page: pause a queued/sending
// campaign (dequeues not-yet-processed BullMQ jobs, in-flight sends finish
// naturally) and resume it later (re-enqueues everything still "queued").
// See services/campaignService.ts pauseCampaign()/resumeCampaign().
campaignsRouter.post(
  "/campaigns/:id/pause",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");
    try {
      const result = await pauseCampaign(idParsed.data.id);
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        return sendError(req, res, 409, "invalid_state_transition", err.message);
      }
      throw err;
    }
  })
);

campaignsRouter.post(
  "/campaigns/:id/resume",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");
    try {
      const result = await resumeCampaign(idParsed.data.id);
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        return sendError(req, res, 409, "invalid_state_transition", err.message);
      }
      throw err;
    }
  })
);

campaignsRouter.get(
  "/campaigns/:id/status",
  asyncHandler(async (req, res) => {
    const idParsed = campaignIdParamSchema.safeParse(req.params);
    if (!idParsed.success) return sendError(req, res, 400, "invalid_query", "invalid campaign id");

    const campaign = await prisma.campaign.findUnique({ where: { id: idParsed.data.id } });
    if (!campaign) return sendError(req, res, 404, "not_found", `no campaign with id ${idParsed.data.id}`);

    const counts = await prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: { status: true },
    });

    const statusCounts: Record<string, number> = {};
    for (const c of counts) statusCounts[c.status] = c._count.status;

    res.json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      approvedBy: campaign.approvedBy,
      approvedAt: campaign.approvedAt,
      sendStartedAt: campaign.sendStartedAt,
      completedAt: campaign.completedAt,
      recipientCounts: statusCounts,
    });
  })
);
