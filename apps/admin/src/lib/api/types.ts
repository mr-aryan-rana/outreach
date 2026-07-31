// Response shapes mirror docs/API.md exactly -- one interface per resource,
// matching what apps/backend, apps/ai, and apps/email actually return (see
// their respective routes/*.ts). Not re-validated with zod at this layer:
// these are trusted internal services reached only through this app's own
// server-side proxy (src/lib/proxyHandler.ts), not third-party/untrusted
// input. Zod is used for user-authored form input instead (src/lib/schemas).

export interface Paginated<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

// ---- apps/backend ----

export interface CreatorListItem {
  id: string;
  handle: string;
  platform: "instagram" | "youtube" | "tiktok";
  niche: string;
  email: string | null;
  confidenceScore: number | null;
}

export interface CreatorDetail extends CreatorListItem {
  websiteUrl: string;
  bio: string | null;
  socialLinks: string[];
  createdAt: string;
}

export interface ReadyCheck {
  status: "ready" | "not_ready";
  checks: { name: string; ok: boolean; error?: string }[];
}

// ---- apps/ai ----

export interface DraftListItem {
  id: string;
  creatorId: string;
  jobId: string | null;
  subject: string;
  brandFitScore: number | null;
  qualityScore: number | null;
  status: "draft" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DraftDetail extends DraftListItem {
  body: string;
  qualityNotes: string | null;
  updatedAt: string;
}

export interface AiGeneration {
  id: string;
  stage: string;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  usedFallback: boolean;
  output: unknown;
  createdAt: string;
  promptVersion: { id: string; version: number; content: string; template: { name: string } } | null;
}

export interface AiJobDetail {
  id: string;
  creatorId: string;
  jobType: "summary" | "brand_fit" | "draft";
  status: "pending" | "processing" | "completed" | "failed";
  input: unknown;
  result: unknown;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  generations: AiGeneration[];
}

export interface PromptVersion {
  id: string;
  version: number;
  content: string;
  variables: string[];
  isActive: boolean;
  createdAt: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  versions: PromptVersion[];
}

export interface CreatorSummary {
  id: string;
  creatorId: string;
  summary: string;
  keyThemes: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- apps/email ----

export type CampaignStatus =
  | "pending_review"
  | "approved"
  | "queued"
  | "sending"
  | "paused"
  | "completed";

export interface Campaign {
  id: string;
  name: string;
  senderProfileId?: string;
  status: CampaignStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  sendStartedAt: string | null;
  completedAt: string | null;
  createdAt?: string;
}

export interface CampaignStatusDetail extends Campaign {
  recipientCounts: Record<string, number>;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  creatorId: string;
  draftEmailId: string;
  email: string;
  status: string;
  queueJobId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface CampaignWithRecipients extends Campaign {
  recipients: CampaignRecipient[];
}

export interface EmailEventItem {
  id: string;
  campaignId: string;
  campaignRecipientId: string;
  email: string;
  eventType: string;
  providerMessageId: string | null;
  metadata: unknown;
  occurredAt: string;
}

export interface SuppressionEntryItem {
  id: string;
  email: string;
  reason: "bounced" | "complained" | "manual" | "unsubscribed";
  source: string | null;
  createdAt: string;
}

export interface SenderProfile {
  id: string;
  name: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  provider: "mock" | "smtp" | "resend" | "ses" | "sendgrid";
  isActive: boolean;
  createdAt: string;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  deadLetter: number;
}

export interface ProviderStats {
  last24h: Record<string, { success: number; error: number }>;
}

export interface RateStats {
  campaignId: string;
  totalSent: number;
  bounceRate: number;
  replyRate: number;
  failureRate: number;
}

export interface DashboardCampaignItem {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  sendStartedAt: string | null;
  completedAt: string | null;
}
