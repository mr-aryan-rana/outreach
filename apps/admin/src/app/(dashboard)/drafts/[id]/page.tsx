"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, X, Save } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { StatusBadge } from "@/components/status-badge";
import { QueryError } from "@/components/query-error";
import { useDraft, useJob, useUpdateDraft } from "@/hooks/use-drafts";
import { draftEditSchema, type DraftEditValues } from "@/lib/schemas/draft";
import { formatDateTime } from "@/lib/format";

function PromptVersionCompare({ jobId }: { jobId: string | null }) {
  const { data: job, isLoading, isError } = useJob(jobId ?? undefined);

  if (!jobId) return <p className="text-sm text-muted-foreground">This draft has no associated generation job.</p>;
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !job) return <p className="text-sm text-muted-foreground">Generation pipeline detail unavailable.</p>;

  return (
    <div className="space-y-3">
      {job.generations.map((g) => (
        <div key={g.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium capitalize">{g.stage.replace(/_/g, " ")}</span>
            <div className="flex flex-wrap items-center gap-2">
              {g.promptVersion ? (
                <Badge variant="outline">
                  {g.promptVersion.template.name} v{g.promptVersion.version}
                </Badge>
              ) : null}
              <Badge variant="secondary">{g.provider}</Badge>
              {g.usedFallback ? <Badge variant="outline">fallback used</Badge> : null}
              <span className="text-xs text-muted-foreground">{g.latencyMs}ms</span>
              {g.estimatedCostUsd !== null ? (
                <span className="text-xs text-muted-foreground">${g.estimatedCostUsd.toFixed(5)}</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: draft, isLoading, isError, error, refetch } = useDraft(id);
  const updateDraft = useUpdateDraft(id);
  const [confirmAction, setConfirmAction] = React.useState<"approved" | "rejected" | null>(null);

  const form = useForm<DraftEditValues>({
    resolver: zodResolver(draftEditSchema),
    values: draft ? { subject: draft.subject, body: draft.body, reviewedBy: draft.reviewedBy ?? "" } : undefined,
  });

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (isError || !draft) return <QueryError error={error} onRetry={() => refetch()} />;

  function onSave(values: DraftEditValues) {
    updateDraft.mutate({ subject: values.subject, body: values.body, reviewedBy: values.reviewedBy || undefined });
  }

  function onDecision(status: "approved" | "rejected") {
    const values = form.getValues();
    if (!values.reviewedBy) {
      form.setError("reviewedBy", { message: "Your name is required to approve or reject a draft" });
      return;
    }
    updateDraft.mutate(
      { subject: values.subject, body: values.body, status, reviewedBy: values.reviewedBy },
      { onSuccess: () => router.push("/drafts") }
    );
  }

  return (
    <div>
      <Link href="/drafts" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to drafts
      </Link>
      <PageHeader
        title="Draft Review"
        description={`For creator ${draft.creatorId}`}
        actions={<StatusBadge status={draft.status} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit draft</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form noValidate onSubmit={form.handleSubmit(onSave)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="body"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Body</FormLabel>
                        <FormControl>
                          <Textarea rows={12} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reviewedBy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reviewed by (required to approve/reject)</FormLabel>
                        <FormControl>
                          <Input placeholder="you@makeable.example" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="submit" variant="outline" disabled={updateDraft.isPending}>
                      <Save className="size-4" /> Save edits
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      disabled={updateDraft.isPending}
                      onClick={() => setConfirmAction("approved")}
                    >
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={updateDraft.isPending}
                      onClick={() => setConfirmAction("rejected")}
                    >
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Brand fit</span>
                <span>{draft.brandFitScore !== null ? `${(draft.brandFitScore * 100).toFixed(0)}%` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quality</span>
                <span>{draft.qualityScore !== null ? `${(draft.qualityScore * 100).toFixed(0)}%` : "—"}</span>
              </div>
              {draft.qualityNotes ? (
                <>
                  <Separator />
                  <p className="text-muted-foreground">{draft.qualityNotes}</p>
                </>
              ) : null}
              {draft.reviewedBy ? (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Reviewed by {draft.reviewedBy} on {formatDateTime(draft.reviewedAt)}
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compare prompt versions</CardTitle>
            </CardHeader>
            <CardContent>
              <PromptVersionCompare jobId={draft.jobId} />
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === "approved" ? "Approve this draft?" : "Reject this draft?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "approved"
                ? "This marks the draft as approved and records you as the reviewer. It does not send anything or create a campaign."
                : "This marks the draft as rejected and records you as the reviewer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction) onDecision(confirmAction);
                setConfirmAction(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
