import { useQuery } from "@tanstack/react-query";
import { fetchReady } from "@/lib/api/http";

export function useSystemStatus(service: "backend" | "ai" | "email") {
  return useQuery({
    queryKey: ["system-status", service],
    queryFn: () => fetchReady(service),
    refetchInterval: 30_000,
    retry: false,
  });
}
