import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  // Campaign lifecycle
  pending_review: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
  queued: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
  sending: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
  paused: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  // Draft review
  draft: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-300",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
  // Recipient / event status
  pending: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-300",
  suppressed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
  delivered: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  deferred: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  bounced: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
  opened: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300",
  clicked: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300",
  replied: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium capitalize", STATUS_STYLES[status], className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
