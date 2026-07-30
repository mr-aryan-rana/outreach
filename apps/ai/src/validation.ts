import { z } from "zod";

export const creatorIdBodySchema = z.object({
  creatorId: z.string().uuid(),
  forceRegenerateSummary: z.boolean().optional(),
});

export const brandSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  values: z.string().max(1000).optional(),
  targetAudience: z.string().max(1000).optional(),
});

export const brandFitRequestSchema = creatorIdBodySchema.extend({
  brand: brandSchema,
});

export const draftRequestSchema = creatorIdBodySchema.extend({
  brand: brandSchema,
});

export const jobIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const draftIdParamSchema = z.object({
  id: z.string().uuid(),
});
