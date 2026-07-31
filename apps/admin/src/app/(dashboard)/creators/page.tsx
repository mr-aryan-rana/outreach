"use client";

import * as React from "react";
import Link from "next/link";
import { Users, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { SimplePager } from "@/components/simple-pager";
import { useCreators } from "@/hooks/use-creators";

const PLATFORMS = ["instagram", "youtube", "tiktok"] as const;
const PAGE_SIZE = 20;

export default function CreatorsPage() {
  const [page, setPage] = React.useState(1);
  const [niche, setNiche] = React.useState("");
  const [platform, setPlatform] = React.useState<string>("all");
  const [quickSearch, setQuickSearch] = React.useState("");

  const { data, isLoading, isError, error, refetch } = useCreators({
    page,
    pageSize: PAGE_SIZE,
    niche: niche || undefined,
    platform: platform === "all" ? undefined : platform,
  });

  const visibleItems = React.useMemo(() => {
    if (!data) return [];
    if (!quickSearch.trim()) return data.items;
    const q = quickSearch.toLowerCase();
    return data.items.filter((c) => c.handle.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q));
  }, [data, quickSearch]);

  return (
    <div>
      <PageHeader title="Creators" description="Discovered creators, their validated contact info, and confidence scores." />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search this page by handle or email..."
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              className="pl-8"
              aria-label="Search current page results"
            />
          </div>
          <Input
            placeholder="Filter by niche (exact match)"
            value={niche}
            onChange={(e) => {
              setNiche(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by niche"
          />
          <Select
            value={platform}
            onValueChange={(v) => {
              if (v) setPlatform(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by platform">
              <SelectValue placeholder="All platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Users} title="No creators found" description="Try a different niche or platform filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Handle</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Niche</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                          {c.handle}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize">{c.platform}</TableCell>
                      <TableCell>{c.niche}</TableCell>
                      <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                      <TableCell>
                        {c.confidenceScore !== null ? (
                          <Badge variant="outline">{(c.confidenceScore * 100).toFixed(0)}%</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {quickSearch && visibleItems.length !== data.items.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {visibleItems.length} of {data.items.length} loaded rows matching &ldquo;{quickSearch}&rdquo;.
              </p>
            ) : null}
            <SimplePager page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
