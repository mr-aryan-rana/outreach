import { z } from "zod";

export const recipientSchema = z.object({
  creatorId: z.string().uuid(),
  draftEmailId: z.string().uuid(),
  email: z.string().email(),
});

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  senderProfileId: z.string().uuid(),
  recipients: z.array(recipientSchema).min(1).max(1000),
});

export const approveCampaignSchema = z.object({
  approvedBy: z.string().min(1).max(200),
});

export const campaignIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const emailEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(50).transform((v) => Math.min(v, 200)),
  campaignId: z.string().uuid().optional(),
  eventType: z.string().optional(),
});

export const suppressionEntrySchema = z.object({
  email: z.string().email(),
  reason: z.enum(["bounced", "complained", "manual", "unsubscribed"]),
  source: z.string().max(500).optional(),
});

export const createSenderProfileSchema = z.object({
  name: z.string().min(1).max(200),
  fromEmail: z.string().email(),
  fromName: z.string().min(1).max(200),
  replyTo: z.string().email().optional(),
  provider: z.enum(["mock", "smtp", "resend", "ses", "sendgrid"]),
});
