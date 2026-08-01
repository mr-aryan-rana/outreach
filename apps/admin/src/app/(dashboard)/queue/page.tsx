"use client";

import Link from "next/link";
import { ListOrdered, RotateCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { useQueueCounts, useDeadLetterJobs, useRetryDeadLetter } from "@/hooks/use-queue";
import { useCan } from "@/hooks/use-can";
import { formatDateTime } from "@/lib/format";

function QueueCountCard({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function QueuePage() {
  const { data: counts, isLoading: countsLoading, isError: countsError, error: countsErr, refetch: refetchCounts } = useQueueCounts();
  const { data: dlq, isLoading: dlqLoading, isError: dlqError, error: dlqErr, refetch: refetchDlq } = useDeadLetterJobs();
  const retry = useRetryDeadLetter();
  const canRetry = useCan("queue.retry");

  return (
    <div>
      <PageHeader title="Queue" description="Live BullMQ send-queue state and dead-letter recovery." />

      {countsLoading ? (
        <Skeleton className="mb-6 h-24 w-full" />
      ) : countsError ? (
        <QueryError error={countsErr} onRetry={() => refetchCounts()} />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <QueueCountCard label="Pending (waiting)" value={counts?.waiting ?? 0} />
          <QueueCountCard label="Pending (delayed)" value={counts?.delayed ?? 0} />
          <QueueCountCard label="Processing" value={counts?.active ?? 0} />
          <QueueCountCard label="Completed" value={counts?.completed ?? 0} />
          <QueueCountCard label="Dead letter" value={counts?.deadLetter ?? 0} tone="danger" />
        </div>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Failed / dead-lettered jobs</h3>
        </div>
        {dlqLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : dlqError ? (
          <QueryError error={dlqErr} onRetry={() => refetchDlq()} />
        ) : !dlq || dlq.items.length === 0 ? (
          <EmptyState icon={ListOrdered} title="Nothing in the dead-letter queue" description="Every send has succeeded or is still retrying." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Failure reason</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dlq.items.map((job) => (
                  <TableRow key={job.jobId}>
                    <TableCell>{job.email ?? "—"}</TableCell>
                    <TableCell>
                      {job.campaignId ? (
                        <Link href={`/campaigns/${job.campaignId}`} className="text-primary hover:underline">
                          {job.campaignName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{job.failedReason ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{job.timestamp ? formatDateTime(job.timestamp) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retry.isPending || !canRetry}
                        onClick={() => retry.mutate(job.jobId)}
                      >
                        <RotateCw className="size-4" /> Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
