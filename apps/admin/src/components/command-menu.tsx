"use client";

import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/components/nav-config";

/**
 * Cmd/Ctrl+K command palette for quick navigation -- the "Keyboard Shortcuts"
 * UI requirement. Kept intentionally simple (navigation only, no fuzzy
 * cross-resource search) since there's no unified search API across the
 * three backend services to back a real omnisearch. Open state is lifted to
 * the dashboard layout so both this and the header's Search button control
 * the same dialog.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Quick navigation" description="Jump to any page">
      <CommandInput placeholder="Type a page name..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              onSelect={() => {
                onOpenChange(false);
                router.push(item.href);
              }}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
