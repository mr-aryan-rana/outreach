"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Send, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { useSenderProfiles, useCreateSenderProfile } from "@/hooks/use-sender-profiles";
import { senderProfileSchema, type SenderProfileValues } from "@/lib/schemas/campaign";

const PROVIDERS = ["mock", "smtp", "resend", "ses", "sendgrid"] as const;

function CreateSenderProfileDialog() {
  const [open, setOpen] = React.useState(false);
  const create = useCreateSenderProfile();
  const form = useForm<SenderProfileValues>({
    resolver: zodResolver(senderProfileSchema),
    defaultValues: { name: "", fromEmail: "", fromName: "", replyTo: "", provider: "mock" },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus className="size-4" /> New sender profile</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sender profile</DialogTitle>
          <DialogDescription>
            SPF/DKIM/DMARC verification and provider credentials are configured outside this UI -- see the Settings page.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) =>
              create.mutate(
                { ...values, replyTo: values.replyTo || undefined },
                { onSuccess: () => { setOpen(false); form.reset(); } }
              )
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Marketing (Mock)" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fromEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>From email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="brand@makeable.example" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fromName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>From name</FormLabel>
                  <FormControl>
                    <Input placeholder="MakeAble" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function SenderProfilesPage() {
  const { data, isLoading, isError, error, refetch } = useSenderProfiles();

  return (
    <div>
      <PageHeader
        title="Sender Profiles"
        description="From-identities campaigns send through."
        actions={<CreateSenderProfileDialog />}
      />

      {isLoading ? (
        <TableSkeleton rows={4} cols={3} />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={Send} title="No sender profiles yet" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((profile) => (
            <Card key={profile.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {profile.name}
                  <Badge variant="secondary">{profile.provider}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {profile.fromName} &lt;{profile.fromEmail}&gt;
                </p>
                {profile.replyTo ? <p className="text-xs text-muted-foreground">Reply-to: {profile.replyTo}</p> : null}
                <div className="flex items-center gap-1.5 pt-1 text-xs">
                  {profile.isActive ? (
                    <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="size-3.5 text-amber-600" aria-hidden="true" />
                  )}
                  {profile.isActive ? "Active" : "Inactive"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
