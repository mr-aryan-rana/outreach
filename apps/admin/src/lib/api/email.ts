import { apiFetch } from "./http";
import {
  Campaign,
  CampaignStatusDetail,
  CampaignWithRecipients,
  DashboardCampaignItem,
  EmailEventItem,
  Paginated,
  ProviderStats,
  QueueCounts,
  RateStats,
  SenderProfile,
  SuppressionEntryItem,
} from "./types";

export const emailApi = {
  // Campaigns
  createCampaign: (body: {
    name: string;
    senderProfileId: string;
    recipients: { creatorId: string; draftEmailId: string; email: string }[];
  }) => apiFetch<CampaignWithRecipients>("email", "campaigns", { method: "POST", body }),

  approveCampaign: (id: string, approvedBy: string) =>
    apiFetch<Campaign>("email", `campaigns/${id}/approve`, { method: "POST", body: { approvedBy } }),

  sendCampaign: (id: string) =>
    apiFetch<{ campaignId: string; enqueued: number }>("email", `campaigns/${id}/send`, { method: "POST" }),

  pauseCampaign: (id: string) =>
    apiFetch<{ campaign: Campaign; dequeued: number; stillInFlight: number }>("email", `campaigns/${id}/pause`, {
      method: "POST",
    }),

  resumeCampaign: (id: string) =>
    apiFetch<{ campaignId: string; enqueued: number }>("email", `campaigns/${id}/resume`, { method: "POST" }),

  getCampaignStatus: (id: string) => apiFetch<CampaignStatusDetail>("email", `campaigns/${id}/status`),

  // Email events
  listEvents: (params: { page?: number; pageSize?: number; campaignId?: string; eventType?: string }) =>
    apiFetch<Paginated<EmailEventItem>>("email", "email-events", { query: params }),

  // Suppression
  listSuppression: () => apiFetch<{ items: SuppressionEntryItem[] }>("email", "suppression"),

  addSuppression: (body: { email: string; reason: "bounced" | "complained" | "manual" | "unsubscribed"; source?: string }) =>
    apiFetch<SuppressionEntryItem>("email", "suppression", { method: "POST", body }),

  // Sender profiles
  listSenderProfiles: () => apiFetch<{ items: SenderProfile[] }>("email", "sender-profiles"),

  createSenderProfile: (body: {
    name: string;
    fromEmail: string;
    fromName: string;
    replyTo?: string;
    provider: "mock" | "smtp" | "resend" | "ses" | "sendgrid";
  }) => apiFetch<SenderProfile>("email", "sender-profiles", { method: "POST", body }),

  // Dashboard
  dashboardCampaigns: () => apiFetch<{ items: DashboardCampaignItem[] }>("email", "dashboard/campaigns"),
  dashboardQueue: () => apiFetch<QueueCounts>("email", "dashboard/queue"),
  dashboardProviders: () => apiFetch<ProviderStats>("email", "dashboard/providers"),
  dashboardRates: (campaignId?: string) => apiFetch<RateStats>("email", "dashboard/rates", { query: { campaignId } }),

  listDeadLetter: () =>
    apiFetch<{
      items: {
        jobId: string;
        campaignRecipientId: string;
        email: string | null;
        campaignId: string | null;
        campaignName: string | null;
        failedReason: string | null;
        timestamp: string | null;
      }[];
    }>("email", "dashboard/queue/dlq"),

  retryDeadLetter: (jobId: string) =>
    apiFetch<{ campaignRecipientId: string; requeued: boolean; jobId: string }>(
      "email",
      `dashboard/queue/dlq/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" }
    ),

  getCreatorCampaignHistory: (creatorId: string) =>
    apiFetch<{
      items: {
        campaignId: string;
        campaignName: string;
        campaignStatus: string;
        recipientStatus: string;
        email: string;
        sentAt: string | null;
        createdAt: string;
      }[];
    }>("email", `creators/${creatorId}/campaign-history`),

  markReplied: (campaignId: string, recipientId: string) =>
    apiFetch<{ ok: boolean }>("email", `campaigns/${campaignId}/recipients/${recipientId}/mark-replied`, {
      method: "POST",
    }),
};
