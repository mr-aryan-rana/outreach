import { z } from "zod";

export const draftEditSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(500, "Subject must be 500 characters or fewer"),
  body: z.string().min(1, "Body is required"),
  reviewedBy: z.string().min(1, "Your name is required to approve or reject a draft").max(200),
});

export type DraftEditValues = z.infer<typeof draftEditSchema>;
