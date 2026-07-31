"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { CommandMenu } from "@/components/command-menu";
import { OfflineBanner } from "@/components/offline-banner";
import { NAV_ITEMS } from "@/components/nav-config";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    let gPending = false;
    let gTimeout: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
        return;
      }

      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      // "g" followed by another key navigates -- e.g. "g" then "d" jumps to
      // Dashboard, matching each nav item's `shortcut` (nav-config.ts).
      if (!gPending && e.key.toLowerCase() === "g") {
        gPending = true;
        gTimeout = setTimeout(() => {
          gPending = false;
        }, 1200);
        return;
      }

      if (gPending) {
        gPending = false;
        if (gTimeout) clearTimeout(gTimeout);
        const match = NAV_ITEMS.find((item) => item.shortcut === `g ${e.key.toLowerCase()}`);
        if (match) {
          e.preventDefault();
          router.push(match.href);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <SiteHeader onOpenCommand={() => setCommandOpen(true)} />
          <main id="main-content" className="flex-1 overflow-x-hidden p-4 md:p-6">
            {children}
          </main>
        </div>
        <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      </div>
    </div>
  );
}
