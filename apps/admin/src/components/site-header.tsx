"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import { NAV_ITEMS } from "@/components/nav-config";

export function SiteHeader({ onOpenCommand }: { onOpenCommand: () => void }) {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <header className="flex h-14 items-center gap-3 border-b px-4">
      <MobileNav />
      <h1 className="text-sm font-medium text-foreground/90">{current?.label ?? "MakeAble Admin"}</h1>
      <div className="ml-auto">
        <Button variant="outline" size="sm" onClick={onOpenCommand} className="gap-2 text-muted-foreground">
          <Search className="size-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>
        </Button>
      </div>
    </header>
  );
}
