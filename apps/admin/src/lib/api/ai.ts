import { apiFetch } from "./http";
import { AiJobDetail, CreatorSummary, DraftDetail, DraftListItem, Paginated, PromptTemplate } from "./types";

export const aiApi = {
  listDrafts: (params: { page?: number; pageSize?: number; status?: string; creatorId?: string }) =>
    apiFetch<Paginated<DraftListItem>>("ai", "ai/drafts", { query: params }),

  getDraft: (id: string) => apiFetch<DraftDetail>("ai", `ai/drafts/${id}`),

  updateDraft: (
    id: string,
    body: { subject?: string; body?: string; status?: "draft" | "approved" | "rejected" },
    reviewedBy?: string
  ) => apiFetch<DraftDetail>("ai", `ai/drafts/${id}`, { method: "PATCH", body, reviewedBy }),

  getJob: (id: string) => apiFetch<AiJobDetail>("ai", `ai/jobs/${id}`),

  listPrompts: () => apiFetch<{ items: PromptTemplate[] }>("ai", "ai/prompts"),

  getSummary: (creatorId: string) => apiFetch<CreatorSummary>("ai", `ai/summary/${creatorId}`),

  generateDraft: (params: {
    creatorId: string;
    brand: { name: string; description: string; values?: string; targetAudience?: string };
    forceRegenerateSummary?: boolean;
  }) => apiFetch<{ jobId: string; draft: DraftDetail; fitReasoning: string }>("ai", "ai/draft", { method: "POST", body: params }),
};
