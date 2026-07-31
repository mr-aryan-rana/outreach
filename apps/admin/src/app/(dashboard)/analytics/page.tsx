"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { BarChart3 } from "lucide-react";
import { useAnalyticsSummary } from "@/hooks/use-analytics";
import { formatPercent } from "@/lib/format";

const FUNNEL_LABELS: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Failed",
};

const FUNNEL_COLORS: Record<string, string> = {
  sent: "var(--chart-1, #3b82f6)",
  delivered: "var(--chart-2, #10b981)",
  opened: "var(--chart-3, #14b8a6)",
  clicked: "var(--chart-4, #8b5cf6)",
  replied: "var(--chart-5, #22c55e)",
  bounced: "#ef4444",
  failed: "#f97316",
};

function RateCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatPercent(value)}</div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading, isError, error, refetch } = useAnalyticsSummary();

  return (
    <div>
      <PageHeader title="Analytics" description="Aggregate delivery funnel and rates across all campaigns." />

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !data || data.campaignCount === 0 ? (
        <EmptyState icon={BarChart3} title="No campaign data yet" description="Analytics populate once a campaign has been sent." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <RateCard label="Bounce rate" value={data.rates.bounceRate} />
            <RateCard label="Reply rate" value={data.rates.replyRate} />
            <RateCard label="Failure rate" value={data.rates.failureRate} />
            <RateCard
              label="Conversion (replied / sent)"
              value={data.funnel.sent > 0 ? data.funnel.replied / data.funnel.sent : 0}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(data.funnel).map(([status, count]) => ({
                      status: FUNNEL_LABELS[status] ?? status,
                      count,
                      fill: FUNNEL_COLORS[status],
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
