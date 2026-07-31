import { useQuery } from "@tanstack/react-query";
import { aiApi } from "@/lib/api/ai";
import { backendApi } from "@/lib/api/backend";

export interface ApprovedDraftRecipient {
  draftId: string;
  subject: string;
  creatorId: string;
  creatorHandle: string;
  email: string | null;
}

/**
 * Campaign creation needs {creatorId, draftEmailId, email} triples
 * (docs/API.md POST /campaigns), but approved drafts (apps/ai) don't carry
 * the creator's email -- that lives in apps/backend's Creator record. This
 * composes both (no new endpoint needed) so the Create Campaign dialog can
 * let an operator pick from approved drafts directly rather than
 * hand-assembling recipient JSON.
 */
export function useApprovedDraftsWithEmail() {
  return useQuery({
    queryKey: ["approved-drafts-with-email"],
    queryFn: async (): Promise<ApprovedDraftRecipient[]> => {
      const drafts = await aiApi.listDrafts({ page: 1, pageSize: 100, status: "approved" });
      const uniqueCreatorIds = [...new Set(drafts.items.map((d) => d.creatorId))];
      const creators = await Promise.all(
        uniqueCreatorIds.map((id) => backendApi.getCreator(id).catch(() => null))
      );
      const creatorById = new Map(creators.filter(Boolean).map((c) => [c!.id, c!]));

      return drafts.items.map((d) => {
        const creator = creatorById.get(d.creatorId);
        return {
          draftId: d.id,
          subject: d.subject,
          creatorId: d.creatorId,
          creatorHandle: creator?.handle ?? d.creatorId,
          email: creator?.email ?? null,
        };
      });
    },
  });
}
