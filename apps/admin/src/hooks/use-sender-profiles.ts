import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emailApi } from "@/lib/api/email";
import { ApiError } from "@/lib/api/http";

export function useSenderProfiles() {
  return useQuery({
    queryKey: ["sender-profiles"],
    queryFn: () => emailApi.listSenderProfiles(),
  });
}

export function useCreateSenderProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: emailApi.createSenderProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sender-profiles"] });
      toast.success("Sender profile created");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to create sender profile");
    },
  });
}
