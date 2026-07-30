import { z } from "zod";

export const PLATFORMS = ["instagram", "youtube", "tiktok"] as const;

export const ingestRunSchema = z.object({
  niche: z.string().min(1).max(200),
  platform: z.enum(PLATFORMS),
});

export type IngestRunInput = z.infer<typeof ingestRunSchema>;

export const creatorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Clamped rather than rejected to preserve the pre-existing behavior of
  // silently capping oversized page sizes instead of erroring.
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((value) => Math.min(value, 100)),
  niche: z.string().min(1).max(200).optional(),
  platform: z.enum(PLATFORMS).optional(),
});

export type CreatorsQueryInput = z.infer<typeof creatorsQuerySchema>;
