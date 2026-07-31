"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FileEdit } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { SimplePager } from "@/components/simple-pager";
import { useDrafts } from "@/hooks/use-drafts";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;
const STATUSES = ["draft", "approved", "rejected"] as const;

export default function DraftsPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={8} cols={5} />}>
      <DraftsPageInner />
    </React.Suspense>
  );
}

function DraftsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const status = searchParams.get("status") ?? "all";

  const { data, isLoading, isError, error, refetch } = useDrafts({
    page,
    pageSize: PAGE_SIZE,
    status: status === "all" ? undefined : status,
  });

  function setStatus(value: string) {
    setPage(1);
    const params = new URLSearchParams(searchParams);
    if (value === "all") params.delete("status");
    else params.set("status", value);
    router.push(`/drafts?${params.toString()}`);
  }

  return (
    <div>
      <PageHeader title="AI Draft Review" description="Review, edit, approve, or reject AI-generated outreach drafts before they're used in a campaign." />

      <Card className="mb-4 p-4">
        <Select value={status} onValueChange={(v) => v && setStatus(v)}>
          <SelectTrigger className="w-56" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="p-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={FileEdit} title="No drafts found" description="Generate drafts via the AI pipeline, then review them here." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Brand Fit</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-md">
                        <Link href={`/drafts/${d.id}`} className="font-medium hover:underline">
                          {d.subject}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={d.status} />
                      </TableCell>
                      <TableCell>{d.brandFitScore !== null ? `${(d.brandFitScore * 100).toFixed(0)}%` : "—"}</TableCell>
                      <TableCell>{d.qualityScore !== null ? `${(d.qualityScore * 100).toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(d.createdAt)}</TableCell>
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
