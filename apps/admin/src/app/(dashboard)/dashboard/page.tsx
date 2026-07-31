"use client";

import Link from "next/link";
import { Users, FileEdit, Megaphone, ListOrdered, Mail } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { ErrorBoundary } from "@/components/error-boundary";
import { useKpis } from "@/hooks/use-kpis";
import { useDashboardCampaigns } from "@/hooks/use-campaigns";
import { useQueueCounts } from "@/hooks/use-queue";
import { useEmailEvents } from "@/hooks/use-email-events";
import { formatDistanceToNow } from "@/lib/format";

function KpiCard({ label, value, icon: Icon, href }: { label: string; value: number | undefined; icon: typeof Users; href: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          {value === undefined ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{value}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiSection() {
  const { data, isError, error, refetch } = useKpis();
  if (isError) return <QueryError error={error} onRetry={() => refetch()} />;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard label="Total Creators" value={data?.totalCreators} icon={Users} href="/creators" />
      <KpiCard label="Drafts Pending Review" value={data?.draftsPendingReview} icon={FileEdit} href="/drafts?status=draft" />
      <KpiCard label="Drafts Approved" value={data?.draftsApproved} icon={FileEdit} href="/drafts?status=approved" />
    </div>
  );
}

function ActiveCampaignsSection() {
  const { data, isLoading, isError, error, refetch } = useDashboardCampaigns();
  const active = data?.items.filter((c) => ["approved", "queued", "sending", "paused"].includes(c.status));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" aria-hidden="true" /> Active Campaigns
        </CardTitle>
        <Link href="/campaigns" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !active || active.length === 0 ? (
          <EmptyState title="No active campaigns" description="Approved, queued, sending, or paused campaigns show up here." />
        ) : (
          <ul className="space-y-2">
            {active.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/campaigns/${c.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="truncate">{c.name}</span>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QueueHealthSection() {
  const { data, isLoading, isError, error, refetch } = useQueueCounts();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListOrdered className="size-4" aria-hidden="true" /> Queue Health
        </CardTitle>
        <Link href="/queue" className="text-sm text-primary hover:underline">
          View queue
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : (
          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            {(["waiting", "active", "delayed", "failed", "completed", "deadLetter"] as const).map((key) => (
              <div key={key} className="rounded-md border p-2">
                <div className={key === "deadLetter" || key === "failed" ? "text-lg font-bold text-destructive" : "text-lg font-bold"}>
                  {data?.[key] ?? 0}
                </div>
                <div className="text-xs capitalize text-muted-foreground">
                  {key === "deadLetter" ? "Dead letter" : key}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivitySection() {
  const { data, isLoading, isError, error, refetch } = useEmailEvents({ page: 1, pageSize: 8 });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" aria-hidden="true" /> Recent Activity
        </CardTitle>
        <Link href="/email-events" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No email activity yet" />
        ) : (
          <ul className="space-y-2 text-sm">
            {data.items.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.email}</p>
                  <p className="text-xs text-muted-foreground">{formatDistanceToNow(e.occurredAt)}</p>
                </div>
                <StatusBadge status={e.eventType} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="Dashboard" description="Overview of creators, drafts, campaigns, and queue health." />
      <div className="space-y-6">
        <ErrorBoundary fallbackLabel="Couldn't load KPIs.">
          <KpiSection />
        </ErrorBoundary>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ErrorBoundary fallbackLabel="Couldn't load active campaigns.">
            <ActiveCampaignsSection />
          </ErrorBoundary>
          <ErrorBoundary fallbackLabel="Couldn't load queue health.">
            <QueueHealthSection />
          </ErrorBoundary>
        </div>
        <ErrorBoundary fallbackLabel="Couldn't load recent activity.">
          <RecentActivitySection />
        </ErrorBoundary>
      </div>
    </div>
  );
}
