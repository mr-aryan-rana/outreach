import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emailApi } from "@/lib/api/email";
import { ApiError } from "@/lib/api/http";

export function useQueueCounts(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ["queue-counts"],
    queryFn: () => emailApi.dashboardQueue(),
    refetchInterval: opts.refetchInterval ?? 10_000,
  });
}

export function useProviderStats() {
  return useQuery({
    queryKey: ["provider-stats"],
    queryFn: () => emailApi.dashboardProviders(),
  });
}

export function useRateStats(campaignId?: string) {
  return useQuery({
    queryKey: ["rate-stats", campaignId ?? "all"],
    queryFn: () => emailApi.dashboardRates(campaignId),
  });
}

export function useDeadLetterJobs() {
  return useQuery({
    queryKey: ["dead-letter-jobs"],
    queryFn: () => emailApi.listDeadLetter(),
    refetchInterval: 15_000,
  });
}

export function useRetryDeadLetter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => emailApi.retryDeadLetter(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue-counts"] });
      queryClient.invalidateQueries({ queryKey: ["dead-letter-jobs"] });
      toast.success("Job re-queued for a fresh send attempt");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Retry failed");
    },
  });
}
