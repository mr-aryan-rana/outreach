"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-can";

export function UserMenu() {
  const user = useCurrentUser();
  if (!user) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-t p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
        <Badge variant="outline" className="mt-0.5 capitalize">
          {user.role}
        </Badge>
      </div>
      <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
