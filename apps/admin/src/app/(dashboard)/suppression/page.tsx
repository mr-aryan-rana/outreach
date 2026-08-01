"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldOff, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { useSuppressionList, useAddSuppression } from "@/hooks/use-suppression";
import { useCan } from "@/hooks/use-can";
import { suppressionSchema, type SuppressionValues } from "@/lib/schemas/campaign";
import { formatDateTime } from "@/lib/format";

function AddSuppressionDialog() {
  const canManage = useCan("suppression.manage");
  const [open, setOpen] = React.useState(false);
  const addSuppression = useAddSuppression();
  const form = useForm<SuppressionValues>({
    resolver: zodResolver(suppressionSchema),
    defaultValues: { email: "", reason: "manual", source: "" },
  });

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus className="size-4" /> Add address</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress an address</DialogTitle>
          <DialogDescription>Manually suppress an address (unsubscribe request, compliance hold).</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) =>
              addSuppression.mutate(
                { email: values.email, reason: values.reason, source: values.source || undefined },
                { onSuccess: () => { setOpen(false); form.reset(); } }
              )
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="creator@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(["manual", "unsubscribed", "bounced", "complained"] as const).map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={addSuppression.isPending}>
                Add to suppression list
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppressionPage() {
  const { data, isLoading, isError, error, refetch } = useSuppressionList();

  return (
    <div>
      <PageHeader
        title="Suppression List"
        description="Addresses that will never receive a send, regardless of campaign."
        actions={<AddSuppressionDialog />}
      />
      <Card className="p-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={3} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={ShieldOff} title="No suppressed addresses" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {entry.reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{entry.source ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
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
