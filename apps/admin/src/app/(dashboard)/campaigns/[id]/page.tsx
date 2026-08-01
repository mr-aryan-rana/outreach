"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Play, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/status-badge";
import { QueryError } from "@/components/query-error";
import { useCampaignStatus, useApproveCampaign, useSendCampaign, usePauseCampaign, useResumeCampaign } from "@/hooks/use-campaigns";
import { useEmailEvents } from "@/hooks/use-email-events";
import { useCan, useCurrentUser } from "@/hooks/use-can";
import { formatDateTime } from "@/lib/format";

const IN_PROGRESS_STATUSES = new Set(["queued", "sending"]);

function ApproveDialog({ campaignId }: { campaignId: string }) {
  const approve = useApproveCampaign();
  const user = useCurrentUser();

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button><Check className="size-4" /> Approve</Button>} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve this campaign?</AlertDialogTitle>
          <AlertDialogDescription>
            This is the required human approval gate -- nothing sends without it. You&apos;ll be recorded as the
            approver ({user?.email}).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => approve.mutate({ id: campaignId, approvedBy: user?.email ?? "" })}
            disabled={approve.isPending}
          >
            Confirm approval
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const send = useSendCampaign();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const canManage = useCan("campaign.manage");

  if (!canManage) return null;

  if (status === "pending_review") return <ApproveDialog campaignId={campaignId} />;

  if (status === "approved") {
    return (
      <AlertDialog>
        <AlertDialogTrigger render={<Button><Send className="size-4" /> Send</Button>} />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start sending this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Recipients are enqueued and sent gradually per the configured rate limits, not all at once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => send.mutate(campaignId)}>Start sending</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (IN_PROGRESS_STATUSES.has(status)) {
    return (
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline"><Pause className="size-4" /> Pause</Button>} />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Not-yet-sent recipients are held back; anything already being sent right now finishes normally.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pause.mutate(campaignId)}>Pause</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (status === "paused") {
    return (
      <Button onClick={() => resume.mutate(campaignId)} disabled={resume.isPending}>
        <Play className="size-4" /> Resume
      </Button>
    );
  }

  return null;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isError, error, refetch } = useCampaignStatus(id, {
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS_STATUSES.has(query.state.data.status) ? 5_000 : false,
  });
  const { data: events } = useEmailEvents({ page: 1, pageSize: 10, campaignId: id });

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !data) return <QueryError error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to campaigns
      </Link>
      <PageHeader
        title={data.name}
        description={`Approved by ${data.approvedBy ?? "—"} on ${formatDateTime(data.approvedAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            <CampaignActions campaignId={id} status={data.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recipient status</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(data.recipientCounts).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recipients recorded yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(data.recipientCounts).map(([status, count]) => (
                  <div key={status} className="rounded-md border p-3 text-center">
                    <div className="text-xl font-bold">{count}</div>
                    <StatusBadge status={status} className="mt-1" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Send started</span>
              <span>{formatDateTime(data.sendStartedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completed</span>
              <span>{formatDateTime(data.completedAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent events for this campaign</CardTitle>
          <Link href={`/email-events?campaignId=${id}`} className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {!events || events.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.items.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>{e.email}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(e.occurredAt)}</span>
                    <StatusBadge status={e.eventType} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
