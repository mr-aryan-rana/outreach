import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/backend";
import { aiApi } from "@/lib/api/ai";

/**
 * No single endpoint gives all Dashboard KPIs -- this composes several
 * cheap, pageSize=1 list calls (each response's `total` is all we need) so
 * the Dashboard doesn't require a new cross-service aggregate endpoint.
 */
export function useKpis() {
  return useQuery({
    queryKey: ["kpis"],
    queryFn: async () => {
      const [creators, pendingDrafts, approvedDrafts] = await Promise.all([
        backendApi.listCreators({ page: 1, pageSize: 1 }),
        aiApi.listDrafts({ page: 1, pageSize: 1, status: "draft" }),
        aiApi.listDrafts({ page: 1, pageSize: 1, status: "approved" }),
      ]);
      return {
        totalCreators: creators.total,
        draftsPendingReview: pendingDrafts.total,
        draftsApproved: approvedDrafts.total,
      };
    },
  });
}
