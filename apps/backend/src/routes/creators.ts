import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { creatorIdParamSchema, creatorsQuerySchema } from "../validation";

export const creatorsRouter = Router();

// Single-creator lookup with full detail (bio/socialLinks included) -- added
// for apps/ai (Sprint 3), which needs real creator content to summarize
// rather than just the list view's summary fields. Registered before the
// list route path-wise doesn't matter here (different path shape), but kept
// first for readability (detail endpoint, then list).
creatorsRouter.get("/creators/:id", asyncHandler(async (req, res) => {
  const parsed = creatorIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendError(req, res, 400, "invalid_query", "invalid creator id", parsed.error.issues);
  }

  const creator = await prisma.creator.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      handle: true,
      platform: true,
      niche: true,
      websiteUrl: true,
      bio: true,
      socialLinks: true,
      createdAt: true,
      emails: {
        select: {
          address: true,
          validationResult: { select: { isValid: true, confidenceScore: true, reasons: true } },
        },
        take: 1,
      },
    },
  });

  if (!creator) {
    return sendError(req, res, 404, "not_found", `no creator with id ${parsed.data.id}`);
  }

  const email = creator.emails[0];
  res.json({
    id: creator.id,
    handle: creator.handle,
    platform: creator.platform,
    niche: creator.niche,
    websiteUrl: creator.websiteUrl,
    bio: creator.bio,
    socialLinks: creator.socialLinks,
    email: email?.address ?? null,
    confidenceScore: email?.validationResult?.confidenceScore ?? null,
    createdAt: creator.createdAt,
  });
}));

creatorsRouter.get("/creators", asyncHandler(async (req, res) => {
  const parsed = creatorsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(req, res, 400, "invalid_query", "invalid query", parsed.error.issues);
  }
  const { page, pageSize, niche, platform } = parsed.data;

  const where: Record<string, unknown> = {};
  if (niche) where.niche = niche;
  if (platform) where.platform = platform;

  const [total, creators] = await Promise.all([
    prisma.creator.count({ where }),
    prisma.creator.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        handle: true,
        platform: true,
        niche: true,
        emails: {
          select: {
            address: true,
            validationResult: { select: { confidenceScore: true } },
          },
          take: 1,
        },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    items: creators.map((c) => ({
      id: c.id,
      handle: c.handle,
      platform: c.platform,
      niche: c.niche,
      email: c.emails[0]?.address ?? null,
      confidenceScore: c.emails[0]?.validationResult?.confidenceScore ?? null,
    })),
  });
}));
