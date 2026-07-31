import { useQuery } from "@tanstack/react-query";
import { emailApi } from "@/lib/api/email";

export function useCreatorCampaignHistory(creatorId: string | undefined) {
  return useQuery({
    queryKey: ["campaign-history", creatorId],
    queryFn: () => emailApi.getCreatorCampaignHistory(creatorId!),
    enabled: !!creatorId,
  });
}
