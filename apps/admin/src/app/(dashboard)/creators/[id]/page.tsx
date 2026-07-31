"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { ExternalLink, Globe, Mail, Sparkles, FileEdit, Megaphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { useCreator } from "@/hooks/use-creators";
import { useCreatorSummary, useDrafts } from "@/hooks/use-drafts";
import { useCreatorCampaignHistory } from "@/hooks/use-campaign-history";
import { formatDateTime } from "@/lib/format";

function OverviewTab({ creatorId }: { creatorId: string }) {
  const { data, isLoading, isError, error, refetch } = useCreator(creatorId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <QueryError error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <dl className="grid grid-cols-[100px_1fr] gap-y-2">
            <dt className="text-muted-foreground">Handle</dt>
            <dd className="font-medium">{data.handle}</dd>
            <dt className="text-muted-foreground">Platform</dt>
            <dd className="capitalize">{data.platform}</dd>
            <dt className="text-muted-foreground">Niche</dt>
            <dd>{data.niche}</dd>
            <dt className="text-muted-foreground">Discovered</dt>
            <dd>{formatDateTime(data.createdAt)}</dd>
          </dl>
          {data.bio ? <p className="pt-2 text-muted-foreground">{data.bio}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4" aria-hidden="true" /> Website &amp; Socials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <a
            href={data.websiteUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {data.websiteUrl}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          {data.socialLinks.length === 0 ? (
            <p className="text-muted-foreground">No social links recorded.</p>
          ) : (
            <ul className="space-y-1">
              {data.socialLinks.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    {link}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" aria-hidden="true" /> Contact &amp; Validation
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {data.email ? (
            <div className="flex items-center gap-3">
              <span className="font-medium">{data.email}</span>
              {data.confidenceScore !== null ? (
                <Badge variant="outline">{(data.confidenceScore * 100).toFixed(0)}% confidence</Badge>
              ) : (
                <span className="text-muted-foreground">no confidence score recorded</span>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No validated email on file for this creator.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AiSummaryTab({ creatorId }: { creatorId: string }) {
  const { data, isLoading, isError, error } = useCreatorSummary(creatorId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No AI summary generated yet"
        description={error instanceof Error ? undefined : "Run the AI drafting pipeline for this creator to generate one."}
      />
    );
  }
  if (!data) return null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6 text-sm">
        <p>{data.summary}</p>
        <div className="flex flex-wrap gap-2">
          {data.keyThemes.map((theme) => (
            <Badge key={theme} variant="secondary">
              {theme}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Last updated {formatDateTime(data.updatedAt)}</p>
      </CardContent>
    </Card>
  );
}

function AiDraftsTab({ creatorId }: { creatorId: string }) {
  const { data, isLoading, isError, error, refetch } = useDrafts({ page: 1, pageSize: 20, creatorId });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={FileEdit} title="No drafts generated for this creator yet" />;
  }

  return (
    <ul className="space-y-2">
      {data.items.map((d) => (
        <li key={d.id}>
          <Link
            href={`/drafts/${d.id}`}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <span className="min-w-0 truncate">{d.subject}</span>
            <StatusBadge status={d.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CampaignHistoryTab({ creatorId }: { creatorId: string }) {
  const { data, isLoading, isError, error, refetch } = useCreatorCampaignHistory(creatorId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={Megaphone} title="This creator hasn't been part of any campaign yet" />;
  }

  return (
    <ul className="space-y-2">
      {data.items.map((item, i) => (
        <li key={`${item.campaignId}-${i}`}>
          <Link
            href={`/campaigns/${item.campaignId}`}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.campaignName}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
            </div>
            <StatusBadge status={item.recipientStatus} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function CreatorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: creator } = useCreator(id);

  return (
    <div>
      <PageHeader title={creator?.handle ?? "Creator"} description={creator?.niche} />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="summary">AI Summary</TabsTrigger>
          <TabsTrigger value="drafts">AI Drafts</TabsTrigger>
          <TabsTrigger value="history">Campaign History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab creatorId={id} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <AiSummaryTab creatorId={id} />
        </TabsContent>
        <TabsContent value="drafts" className="mt-4">
          <AiDraftsTab creatorId={id} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <CampaignHistoryTab creatorId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
