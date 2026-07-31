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
  draftUpdateSchema,
  draftListQuerySchema,
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

// Added for apps/admin (Sprint 5)'s AI Draft Review page: list/filter
// drafts pending (or already given) a human review decision.
aiRouter.get(
  "/ai/drafts",
  asyncHandler(async (req, res) => {
    const parsed = draftListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid query", parsed.error.issues);
    }
    const { page, pageSize, status, creatorId } = parsed.data;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (creatorId) where.creatorId = creatorId;

    const [total, drafts] = await Promise.all([
      prisma.draftEmail.count({ where }),
      prisma.draftEmail.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({
      page,
      pageSize,
      total,
      items: drafts.map((d) => ({
        id: d.id,
        creatorId: d.creatorId,
        jobId: d.jobId,
        subject: d.subject,
        brandFitScore: d.brandFitScore,
        qualityScore: d.qualityScore,
        status: d.status,
        reviewedBy: d.reviewedBy,
        reviewedAt: d.reviewedAt,
        createdAt: d.createdAt,
      })),
    });
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
      reviewedBy: draft.reviewedBy,
      reviewedAt: draft.reviewedAt,
      updatedAt: draft.updatedAt,
      createdAt: draft.createdAt,
    });
  })
);

// Added for apps/admin (Sprint 5)'s AI Draft Review page: a human can edit
// the subject/body before send and/or approve or reject the draft. This
// service still never sends anything -- it only records the review decision.
// apps/email does not currently gate sending on this status (see
// docs/ARCHITECTURE.md "Explicitly not built yet"); it's review-tracking
// only in this slice, not yet a cross-service enforcement boundary.
aiRouter.patch(
  "/ai/drafts/:id",
  asyncHandler(async (req, res) => {
    const idParsed = draftIdParamSchema.safeParse(req.params);
    if (!idParsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid draft id", idParsed.error.issues);
    }
    const bodyParsed = draftUpdateSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", bodyParsed.error.issues);
    }

    const existing = await prisma.draftEmail.findUnique({ where: { id: idParsed.data.id } });
    if (!existing) {
      return sendError(req, res, 404, "not_found", `no draft with id ${idParsed.data.id}`);
    }

    const { subject, body, status } = bodyParsed.data;
    const draft = await prisma.draftEmail.update({
      where: { id: idParsed.data.id },
      data: {
        ...(subject !== undefined ? { subject } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(status !== undefined
          ? { status, reviewedAt: new Date(), reviewedBy: req.header("x-reviewed-by") ?? null }
          : {}),
      },
    });

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
      reviewedBy: draft.reviewedBy,
      reviewedAt: draft.reviewedAt,
      updatedAt: draft.updatedAt,
      createdAt: draft.createdAt,
    });
  })
);

// Added for apps/admin (Sprint 5): read-only view of known prompt templates
// and their versions, for Settings "Prompt Versions" and the Draft Review
// page's "compare prompt versions" view. Content itself is always
// file-authored (prompts/<name>/v<N>.md, see src/prompts/promptLoader.ts) --
// this only reflects the DB's synced record of what's been used, matching
// the "files are the source of truth, DB tracks which version exists" split
// documented in promptService.ts.
aiRouter.get(
  "/ai/prompts",
  asyncHandler(async (_req, res) => {
    const templates = await prisma.promptTemplate.findMany({
      include: { versions: { orderBy: { version: "asc" } } },
      orderBy: { name: "asc" },
    });
    res.json({
      items: templates.map((t) => ({
        id: t.id,
        name: t.name,
        versions: t.versions.map((v) => ({
          id: v.id,
          version: v.version,
          content: v.content,
          variables: v.variables,
          isActive: v.isActive,
          createdAt: v.createdAt,
        })),
      })),
    });
  })
);

// Added for apps/admin (Sprint 5)'s Creator Detail "AI Summary" tab -- there
// was previously no read path for a creator's stored summary outside of
// re-running POST /ai/summary (which regenerates/overwrites it). Read-only.
aiRouter.get(
  "/ai/summary/:creatorId",
  asyncHandler(async (req, res) => {
    const parsed = creatorIdBodySchema.pick({ creatorId: true }).safeParse(req.params);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid creator id", parsed.error.issues);
    }
    const summary = await prisma.creatorSummary.findUnique({ where: { creatorId: parsed.data.creatorId } });
    if (!summary) {
      return sendError(req, res, 404, "not_found", `no summary generated yet for creator ${parsed.data.creatorId}`);
    }
    res.json({
      id: summary.id,
      creatorId: summary.creatorId,
      summary: summary.summary,
      keyThemes: summary.keyThemes,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
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
            output: true,
            createdAt: true,
            // Sprint 5 (apps/admin) Draft Review "compare prompt versions":
            // which exact prompt template+version produced this stage's
            // output, so a reviewer can see the input that shaped the draft.
            promptVersion: {
              select: { id: true, version: true, content: true, template: { select: { name: true } } },
            },
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
