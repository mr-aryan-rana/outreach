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

// Sprint 5 (apps/admin): list/filter drafts for the Draft Review page.
export const draftListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(20).transform((v) => Math.min(v, 100)),
  status: z.enum(["draft", "approved", "rejected"]).optional(),
  creatorId: z.string().uuid().optional(),
});

// Sprint 6 (apps/admin Settings / ops): cost & token usage accounting query.
export const usageQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  provider: z.enum(["openai", "anthropic", "gemini", "mock"]).optional(),
});

// Sprint 5 (apps/admin): human review of a generated draft -- edit
// subject/body before send, or approve/reject it. At least one field must be
// present; a bare "touch" request isn't meaningful.
export const draftUpdateSchema = z
  .object({
    subject: z.string().min(1).max(500).optional(),
    body: z.string().min(1).optional(),
    status: z.enum(["draft", "approved", "rejected"]).optional(),
  })
  .refine((v) => v.subject !== undefined || v.body !== undefined || v.status !== undefined, {
    message: "at least one of subject, body, status must be provided",
  });
