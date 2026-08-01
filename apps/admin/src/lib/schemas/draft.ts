import { z } from "zod";

export const draftEditSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(500, "Subject must be 500 characters or fewer"),
  body: z.string().min(1, "Body is required"),
});

export type DraftEditValues = z.infer<typeof draftEditSchema>;
