import { useQuery } from "@tanstack/react-query";
import { emailApi } from "@/lib/api/email";

const FUNNEL_STATUSES = ["sent", "delivered", "opened", "clicked", "replied", "bounced", "failed"] as const;

/**
 * No single endpoint gives a cross-campaign funnel -- dashboard/rates only
 * computes bounce/reply/failure rate, not the full sent/delivered/opened/
 * clicked breakdown. This composes dashboard/campaigns (list, capped at 50)
 * with one campaigns/:id/status call per campaign (which does have full
 * per-status recipientCounts) and sums them client-side. Acceptable at
 * admin-tool scale; would need a real aggregate endpoint before this list
 * grows into the hundreds.
 */
export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ["analytics-summary"],
    queryFn: async () => {
      const campaigns = await emailApi.dashboardCampaigns();
      const statuses = await Promise.all(campaigns.items.map((c) => emailApi.getCampaignStatus(c.id).catch(() => null)));

      const funnel: Record<(typeof FUNNEL_STATUSES)[number], number> = {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        bounced: 0,
        failed: 0,
      };

      for (const s of statuses) {
        if (!s) continue;
        for (const status of FUNNEL_STATUSES) {
          funnel[status] += s.recipientCounts[status] ?? 0;
        }
      }

      const rates = await emailApi.dashboardRates();

      return { funnel, rates, campaignCount: campaigns.items.length };
    },
  });
}
