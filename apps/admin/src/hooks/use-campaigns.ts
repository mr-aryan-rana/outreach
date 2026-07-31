import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emailApi } from "@/lib/api/email";
import { ApiError } from "@/lib/api/http";
import type { CampaignStatusDetail } from "@/lib/api/types";

export function useDashboardCampaigns() {
  return useQuery({
    queryKey: ["dashboard-campaigns"],
    queryFn: () => emailApi.dashboardCampaigns(),
  });
}

type RefetchInterval =
  | number
  | false
  | ((query: { state: { data: CampaignStatusDetail | undefined } }) => number | false);

export function useCampaignStatus(id: string | undefined, opts: { refetchInterval?: RefetchInterval } = {}) {
  return useQuery({
    queryKey: ["campaign-status", id],
    queryFn: () => emailApi.getCampaignStatus(id!),
    enabled: !!id,
    refetchInterval: opts.refetchInterval,
  });
}

function useCampaignMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  successMessage: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-status"] });
      toast.success(successMessage);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Action failed");
    },
  });
}

export function useCreateCampaign() {
  return useCampaignMutation(emailApi.createCampaign, "Campaign created");
}

export function useApproveCampaign() {
  return useCampaignMutation(
    (vars: { id: string; approvedBy: string }) => emailApi.approveCampaign(vars.id, vars.approvedBy),
    "Campaign approved"
  );
}

export function useSendCampaign() {
  return useCampaignMutation((id: string) => emailApi.sendCampaign(id), "Campaign sending started");
}

export function usePauseCampaign() {
  return useCampaignMutation((id: string) => emailApi.pauseCampaign(id), "Campaign paused");
}

export function useResumeCampaign() {
  return useCampaignMutation((id: string) => emailApi.resumeCampaign(id), "Campaign resumed");
}
