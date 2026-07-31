import { useQuery } from "@tanstack/react-query";
import { emailApi } from "@/lib/api/email";

export function useEmailEvents(params: { page: number; pageSize: number; campaignId?: string; eventType?: string }) {
  return useQuery({
    queryKey: ["email-events", params],
    queryFn: () => emailApi.listEvents(params),
  });
}
