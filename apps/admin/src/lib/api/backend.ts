import { apiFetch } from "./http";
import { CreatorDetail, CreatorListItem, Paginated } from "./types";

export const backendApi = {
  listCreators: (params: { page?: number; pageSize?: number; niche?: string; platform?: string }) =>
    apiFetch<Paginated<CreatorListItem>>("backend", "creators", { query: params }),

  getCreator: (id: string) => apiFetch<CreatorDetail>("backend", `creators/${id}`),

  runIngest: (params: { niche: string; platform: string }) =>
    apiFetch<{ requested: number; extracted: number; validated: number; stored: number; skippedDuplicates: number }>(
      "backend",
      "ingest/run",
      { method: "POST", body: params }
    ),
};
