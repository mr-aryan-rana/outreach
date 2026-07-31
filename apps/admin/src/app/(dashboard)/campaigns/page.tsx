"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { CreateCampaignDialog } from "@/components/create-campaign-dialog";
import { useDashboardCampaigns } from "@/hooks/use-campaigns";
import { formatDateTime } from "@/lib/format";

export default function CampaignsPage() {
  const { data, isLoading, isError, error, refetch } = useDashboardCampaigns();

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Draft, review, approve, and send outreach campaigns."
        actions={<CreateCampaignDialog />}
      />

      <Card className="p-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={4} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create one from approved drafts to get started." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(c.sendStartedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(c.completedAt)}</TableCell>
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
