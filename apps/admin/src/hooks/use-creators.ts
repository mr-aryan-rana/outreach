import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/backend";

export function useCreators(params: { page: number; pageSize: number; niche?: string; platform?: string }) {
  return useQuery({
    queryKey: ["creators", params],
    queryFn: () => backendApi.listCreators(params),
  });
}

export function useCreator(id: string | undefined) {
  return useQuery({
    queryKey: ["creator", id],
    queryFn: () => backendApi.getCreator(id!),
    enabled: !!id,
  });
}
