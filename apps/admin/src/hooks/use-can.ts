"use client";

import { useSession } from "next-auth/react";
import { roleCan, type Permission } from "@/lib/rbac";

/**
 * Client-side convenience only (hide/disable a control a role can't use) --
 * the real enforcement is server-side in every /api/proxy/* route handler
 * (src/lib/proxyHandler.ts). Never treat this hook's result as a security
 * boundary on its own.
 */
export function useCan(permission: Permission): boolean {
  const { data: session } = useSession();
  if (!session?.user) return false;
  return roleCan(session.user.role, permission);
}

export function useCurrentUser() {
  const { data: session } = useSession();
  return session?.user;
}
