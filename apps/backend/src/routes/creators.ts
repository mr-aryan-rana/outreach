import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/asyncHandler";
import { creatorsQuerySchema } from "../validation";

export const creatorsRouter = Router();

creatorsRouter.get("/creators", asyncHandler(async (req, res) => {
  const parsed = creatorsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid query", details: parsed.error.issues });
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
