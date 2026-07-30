import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { CreatorNotFoundError } from "../services/creatorClient";
import { runBrandFitPipeline, runDraftPipeline, runSummaryPipeline } from "../services/pipeline";
import {
  brandFitRequestSchema,
  creatorIdBodySchema,
  draftRequestSchema,
  jobIdParamSchema,
  draftIdParamSchema,
} from "../validation";

function requestId(req: any): string | undefined {
  return req.id;
}

export const aiRouter = Router();

aiRouter.post(
  "/ai/summary",
  asyncHandler(async (req, res) => {
    const parsed = creatorIdBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    try {
      const result = await runSummaryPipeline(parsed.data.creatorId, requestId(req));
      res.json(result);
    } catch (err) {
      if (err instanceof CreatorNotFoundError) {
        return sendError(req, res, 404, "creator_not_found", err.message);
      }
      throw err;
    }
  })
);

aiRouter.post(
  "/ai/brand-fit",
  asyncHandler(async (req, res) => {
    const parsed = brandFitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    try {
      const result = await runBrandFitPipeline(
        parsed.data.creatorId,
        parsed.data.brand,
        requestId(req),
        parsed.data.forceRegenerateSummary
      );
      res.json(result);
    } catch (err) {
      if (err instanceof CreatorNotFoundError) {
        return sendError(req, res, 404, "creator_not_found", err.message);
      }
      throw err;
    }
  })
);

aiRouter.post(
  "/ai/draft",
  asyncHandler(async (req, res) => {
    const parsed = draftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    try {
      const result = await runDraftPipeline(
        parsed.data.creatorId,
        parsed.data.brand,
        requestId(req),
        parsed.data.forceRegenerateSummary
      );
      res.json(result);
    } catch (err) {
      if (err instanceof CreatorNotFoundError) {
        return sendError(req, res, 404, "creator_not_found", err.message);
      }
      throw err;
    }
  })
);

// Added for apps/email (Sprint 4), which needs to read a specific draft's
// content when a campaign recipient is enqueued for sending -- it stores
// only the draftEmailId, never a copy of the subject/body, keeping this
// service the single source of truth for draft content.
aiRouter.get(
  "/ai/drafts/:id",
  asyncHandler(async (req, res) => {
    const parsed = draftIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid draft id", parsed.error.issues);
    }

    const draft = await prisma.draftEmail.findUnique({ where: { id: parsed.data.id } });
    if (!draft) {
      return sendError(req, res, 404, "not_found", `no draft with id ${parsed.data.id}`);
    }

    res.json({
      id: draft.id,
      creatorId: draft.creatorId,
      jobId: draft.jobId,
      subject: draft.subject,
      body: draft.body,
      brandFitScore: draft.brandFitScore,
      qualityScore: draft.qualityScore,
      qualityNotes: draft.qualityNotes,
      status: draft.status,
      createdAt: draft.createdAt,
    });
  })
);

aiRouter.get(
  "/ai/jobs/:id",
  asyncHandler(async (req, res) => {
    const parsed = jobIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid job id", parsed.error.issues);
    }

    const job = await prisma.aiJob.findUnique({
      where: { id: parsed.data.id },
      include: {
        generations: {
          select: {
            id: true,
            stage: true,
            provider: true,
            model: true,
            latencyMs: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            estimatedCostUsd: true,
            usedFallback: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!job) {
      return sendError(req, res, 404, "not_found", `no job with id ${parsed.data.id}`);
    }

    res.json({
      id: job.id,
      creatorId: job.creatorId,
      jobType: job.jobType,
      status: job.status,
      input: job.input,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      generations: job.generations,
    });
  })
);
