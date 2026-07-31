import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  senderProfileId: z.string().uuid("Choose a sender profile"),
  draftIds: z.array(z.string().uuid()).min(1, "Select at least one approved draft"),
});

export type CreateCampaignValues = z.infer<typeof createCampaignSchema>;

export const approveCampaignSchema = z.object({
  approvedBy: z.string().min(1, "Your name is required to approve a campaign").max(200),
});

export type ApproveCampaignValues = z.infer<typeof approveCampaignSchema>;

export const senderProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  fromEmail: z.string().email("Must be a valid email"),
  fromName: z.string().min(1, "From name is required").max(200),
  replyTo: z.string().email("Must be a valid email").optional().or(z.literal("")),
  provider: z.enum(["mock", "smtp", "resend", "ses", "sendgrid"]),
});

export type SenderProfileValues = z.infer<typeof senderProfileSchema>;

export const suppressionSchema = z.object({
  email: z.string().email("Must be a valid email"),
  reason: z.enum(["bounced", "complained", "manual", "unsubscribed"]),
  source: z.string().max(500).optional().or(z.literal("")),
});

export type SuppressionValues = z.infer<typeof suppressionSchema>;
