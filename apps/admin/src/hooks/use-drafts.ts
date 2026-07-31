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

export function usePrompts() {
  return useQuery({
    queryKey: ["prompts"],
    queryFn: () => aiApi.listPrompts(),
  });
}

export function useUpdateDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { subject?: string; body?: string; status?: "draft" | "approved" | "rejected"; reviewedBy?: string }) =>
      aiApi.updateDraft(id, { subject: vars.subject, body: vars.body, status: vars.status }, vars.reviewedBy),
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
