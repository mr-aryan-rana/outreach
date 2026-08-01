import { apiFetch } from "./http";
import { AiJobDetail, CreatorSummary, DraftDetail, DraftListItem, Paginated, PromptTemplate } from "./types";

export const aiApi = {
  listDrafts: (params: { page?: number; pageSize?: number; status?: string; creatorId?: string }) =>
    apiFetch<Paginated<DraftListItem>>("ai", "ai/drafts", { query: params }),

  getDraft: (id: string) => apiFetch<DraftDetail>("ai", `ai/drafts/${id}`),

  // X-Reviewed-By is set server-side from the authenticated session
  // (src/lib/proxyHandler.ts) -- never client-supplied.
  updateDraft: (id: string, body: { subject?: string; body?: string; status?: "draft" | "approved" | "rejected" }) =>
    apiFetch<DraftDetail>("ai", `ai/drafts/${id}`, { method: "PATCH", body }),

  getJob: (id: string) => apiFetch<AiJobDetail>("ai", `ai/jobs/${id}`),

  listPrompts: () => apiFetch<{ items: PromptTemplate[] }>("ai", "ai/prompts"),

  getSummary: (creatorId: string) => apiFetch<CreatorSummary>("ai", `ai/summary/${creatorId}`),

  providerHealth: () =>
    apiFetch<{
      primaryProvider: string;
      fallbackProvider: string;
      providers: { name: string; configured: boolean; circuitBreakerState: "closed" | "half_open" | "open" }[];
    }>("ai", "ai/providers/health"),

  usage: () =>
    apiFetch<{
      totals: { totalTokens: number; estimatedCostUsd: number; generations: number; fallbackUsedCount: number };
      byProviderAndStage: {
        provider: string;
        stage: string;
        generations: number;
        totalTokens: number;
        estimatedCostUsd: number;
        avgLatencyMs: number | null;
      }[];
    }>("ai", "ai/usage"),

  promptsVerify: () =>
    apiFetch<{ anyDrift: boolean; items: { name: string; hasDrift: boolean; versions: { version: number; syncedToDb: boolean; driftDetected: boolean }[] }[] }>(
      "ai",
      "ai/prompts/verify"
    ),

  generateDraft: (params: {
    creatorId: string;
    brand: { name: string; description: string; values?: string; targetAudience?: string };
    forceRegenerateSummary?: boolean;
  }) => apiFetch<{ jobId: string; draft: DraftDetail; fitReasoning: string }>("ai", "ai/draft", { method: "POST", body: params }),
};
