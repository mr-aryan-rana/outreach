import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { aiApi } from "@/lib/api/ai";
import { ApiError } from "@/lib/api/http";

export function useDrafts(params: { page: number; pageSize: number; status?: string; creatorId?: string }) {
  return useQuery({
    queryKey: ["drafts", params],
    queryFn: () => aiApi.listDrafts(params),
  });
}

export function useDraft(id: string | undefined) {
  return useQuery({
    queryKey: ["draft", id],
    queryFn: () => aiApi.getDraft(id!),
    enabled: !!id,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ["ai-job", id],
    queryFn: () => aiApi.getJob(id!),
    enabled: !!id,
  });
}

export function useCreatorSummary(creatorId: string | undefined) {
  return useQuery({
    queryKey: ["creator-summary", creatorId],
    queryFn: () => aiApi.getSummary(creatorId!),
    enabled: !!creatorId,
    retry: false,
  });
}

export function useProviderHealth() {
  return useQuery({
    queryKey: ["ai-provider-health"],
    queryFn: () => aiApi.providerHealth(),
    refetchInterval: 30_000,
  });
}

export function useAiUsage() {
  return useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => aiApi.usage(),
  });
}

export function usePromptsVerify() {
  return useQuery({
    queryKey: ["ai-prompts-verify"],
    queryFn: () => aiApi.promptsVerify(),
  });
}

export function usePrompts() {
  return useQuery({
    queryKey: ["prompts"],
    queryFn: () => aiApi.listPrompts(),
  });
}

export function useUpdateDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // reviewedBy is no longer client-supplied -- the proxy route overwrites
    // X-Reviewed-By with the authenticated session's email regardless of
    // what's sent (src/lib/proxyHandler.ts), so there's nothing meaningful
    // to pass here anymore.
    mutationFn: (vars: { subject?: string; body?: string; status?: "draft" | "approved" | "rejected" }) =>
      aiApi.updateDraft(id, { subject: vars.subject, body: vars.body, status: vars.status }),
    onSuccess: (draft) => {
      queryClient.setQueryData(["draft", id], draft);
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      toast.success(draft.status === "draft" ? "Draft updated" : `Draft ${draft.status}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to update draft");
    },
  });
}
