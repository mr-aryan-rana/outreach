import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emailApi } from "@/lib/api/email";
import { ApiError } from "@/lib/api/http";

export function useSuppressionList() {
  return useQuery({
    queryKey: ["suppression"],
    queryFn: () => emailApi.listSuppression(),
  });
}

export function useAddSuppression() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: emailApi.addSuppression,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppression"] });
      toast.success("Address added to suppression list");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to add suppression entry");
    },
  });
}
