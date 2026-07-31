"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Reply } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { SimplePager } from "@/components/simple-pager";
import { useEmailEvents } from "@/hooks/use-email-events";
import { emailApi } from "@/lib/api/email";
import { ApiError } from "@/lib/api/http";
import { formatDateTime } from "@/lib/format";

const EVENT_TYPES = ["queued", "sent", "delivered", "deferred", "bounced", "opened", "clicked", "replied", "failed"];
const PAGE_SIZE = 25;

function MarkRepliedButton({ campaignId, campaignRecipientId }: { campaignId: string; campaignRecipientId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => emailApi.markReplied(campaignId, campaignRecipientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-events"] });
      toast.success("Marked as replied");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to mark as replied"),
  });

  return (
    <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      <Reply className="size-4" /> Mark replied
    </Button>
  );
}

export default function EmailEventsPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={10} cols={4} />}>
      <EmailEventsPageInner />
    </React.Suspense>
  );
}

function EmailEventsPageInner() {
  const searchParams = useSearchParams();
  const campaignId = searchParams.get("campaignId") ?? undefined;
  const [page, setPage] = React.useState(1);
  const [eventType, setEventType] = React.useState("all");

  const { data, isLoading, isError, error, refetch } = useEmailEvents({
    page,
    pageSize: PAGE_SIZE,
    campaignId,
    eventType: eventType === "all" ? undefined : eventType,
  });

  return (
    <div>
      <PageHeader title="Email Events" description={campaignId ? `Filtered to campaign ${campaignId}` : "Every delivery event across all campaigns."} />

      <Card className="mb-4 p-4">
        <Select
          value={eventType}
          onValueChange={(v) => {
            if (v) setEventType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Filter by event type">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="p-4">
        {isLoading ? (
          <TableSkeleton rows={10} cols={5} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Mail} title="No events found" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Occurred</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.email}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.eventType} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(e.occurredAt)}</TableCell>
                      <TableCell className="text-right">
                        {e.eventType !== "replied" ? (
                          <MarkRepliedButton campaignId={e.campaignId} campaignRecipientId={e.campaignRecipientId} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <SimplePager page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
