"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { createCampaignSchema, type CreateCampaignValues } from "@/lib/schemas/campaign";
import { useApprovedDraftsWithEmail } from "@/hooks/use-approved-drafts-with-email";
import { useSenderProfiles } from "@/hooks/use-sender-profiles";
import { useCreateCampaign } from "@/hooks/use-campaigns";

export function CreateCampaignDialog() {
  const [open, setOpen] = React.useState(false);
  const { data: drafts, isLoading: draftsLoading } = useApprovedDraftsWithEmail();
  const { data: senderProfiles, isLoading: sendersLoading } = useSenderProfiles();
  const createCampaign = useCreateCampaign();

  const form = useForm<CreateCampaignValues>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { name: "", senderProfileId: "", draftIds: [] },
  });

  function onSubmit(values: CreateCampaignValues) {
    const selected = (drafts ?? []).filter((d) => values.draftIds.includes(d.draftId) && d.email);
    createCampaign.mutate(
      {
        name: values.name,
        senderProfileId: values.senderProfileId,
        recipients: selected.map((d) => ({ creatorId: d.creatorId, draftEmailId: d.draftId, email: d.email! })),
      },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset({ name: "", senderProfileId: "", draftIds: [] });
        },
      }
    );
  }

  const eligibleDrafts = (drafts ?? []).filter((d) => d.email);
  const draftIds = form.watch("draftIds");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus className="size-4" /> New Campaign</Button>} />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create campaign</DialogTitle>
          <DialogDescription>
            Recipients are built from approved drafts only -- rejected or unreviewed drafts can&apos;t be selected.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign name</FormLabel>
                  <FormControl>
                    <Input placeholder="Q3 creator outreach" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="senderProfileId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sender profile</FormLabel>
                  {sendersLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a sender profile" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {senderProfiles?.items.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.provider})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="draftIds"
              render={() => (
                <FormItem>
                  <FormLabel>Approved drafts ({draftIds.length} selected)</FormLabel>
                  {draftsLoading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : eligibleDrafts.length === 0 ? (
                    <EmptyState
                      title="No approved drafts with a validated email"
                      description="Approve drafts on the AI Draft Review page first."
                    />
                  ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                      {eligibleDrafts.map((d) => (
                        <label
                          key={d.draftId}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={draftIds.includes(d.draftId)}
                            onCheckedChange={(checked) => {
                              const current = form.getValues("draftIds");
                              form.setValue(
                                "draftIds",
                                checked ? [...current, d.draftId] : current.filter((id) => id !== d.draftId)
                              );
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{d.subject}</span>
                          <span className="text-xs text-muted-foreground">{d.creatorHandle}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={createCampaign.isPending}>
                Create campaign
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
