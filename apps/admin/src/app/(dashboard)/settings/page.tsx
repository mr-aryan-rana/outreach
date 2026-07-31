"use client";

import { CheckCircle2, XCircle, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { useSystemStatus } from "@/hooks/use-system-status";
import { useSenderProfiles } from "@/hooks/use-sender-profiles";
import { usePrompts } from "@/hooks/use-drafts";

const SERVICES = [
  { key: "backend" as const, label: "Backend (creator discovery)" },
  { key: "ai" as const, label: "AI (drafting)" },
  { key: "email" as const, label: "Email (delivery)" },
];

function ServiceStatusCard({ service, label }: { service: "backend" | "ai" | "email"; label: string }) {
  const { data, isLoading } = useSystemStatus(service);
  const ready = data?.status === "ready";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {isLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <Badge variant={ready ? "outline" : "destructive"} className={ready ? "border-emerald-500 text-emerald-600" : ""}>
            {ready ? "Ready" : "Not ready"}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="space-y-1 text-sm">
            {data?.checks.map((check) => (
              <li key={check.name} className="flex items-center gap-2">
                {check.ok ? (
                  <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle className="size-3.5 text-destructive" aria-hidden="true" />
                )}
                <span className="capitalize">{check.name}</span>
                {check.error ? <span className="truncate text-xs text-muted-foreground">— {check.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProvidersSection() {
  const { data, isLoading, isError, error } = useSenderProfiles();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Providers (sender profiles)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryError error={error} />
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sender profiles configured yet -- see Sender Profiles page.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.items.map((p) => (
              <Badge key={p.id} variant="secondary">
                {p.name} · {p.provider}
              </Badge>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Provider credentials (SMTP/Resend/SES/SendGrid API keys) are environment-configured on apps/email, not editable
          from this UI -- see DEPLOYMENT.md &ldquo;Deploying apps/email&rdquo;.
        </p>
      </CardContent>
    </Card>
  );
}

function PromptVersionsSection() {
  const { data, isLoading, isError, error } = usePrompts();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prompt Versions</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryError error={error} />
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prompt templates recorded yet -- they sync on first use.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.items.map((t) => (
              <li key={t.id} className="flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                <div className="flex gap-1">
                  {t.versions.map((v) => (
                    <Badge key={v.id} variant={v.isActive ? "default" : "outline"}>
                      v{v.version}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Prompt content is file-authored (apps/ai/prompts/&lt;name&gt;/v&lt;N&gt;.md) -- this reflects which versions
          have been used, read-only.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Read-only system status. API keys, provider credentials, and infrastructure config are environment-managed, not editable here -- see docs/SECURITY.md."
      />

      <div className="space-y-6">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <SettingsIcon className="size-4" /> Service health
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {SERVICES.map((s) => (
              <ServiceStatusCard key={s.key} service={s.key} label={s.label} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ProvidersSection />
          <PromptVersionsSection />
        </div>
      </div>
    </div>
  );
}
