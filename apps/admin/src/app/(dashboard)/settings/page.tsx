"use client";

import { CheckCircle2, XCircle, AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { useSystemStatus } from "@/hooks/use-system-status";
import { useSenderProfiles } from "@/hooks/use-sender-profiles";
import { usePrompts, useProviderHealth, useAiUsage, usePromptsVerify } from "@/hooks/use-drafts";

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
  const { data: verify } = usePromptsVerify();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Prompt Versions</CardTitle>
        {verify ? (
          <Badge variant={verify.anyDrift ? "destructive" : "outline"} className={verify.anyDrift ? "" : "border-emerald-500 text-emerald-600"}>
            {verify.anyDrift ? "Drift detected" : "In sync"}
          </Badge>
        ) : null}
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
            {data.items.map((t) => {
              const driftForThis = verify?.items.find((v) => v.name === t.name)?.hasDrift;
              return (
                <li key={t.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    {t.name}
                    {driftForThis ? <AlertTriangle className="size-3.5 text-amber-600" aria-label="Drift detected" /> : null}
                  </span>
                  <div className="flex gap-1">
                    {t.versions.map((v) => (
                      <Badge key={v.id} variant={v.isActive ? "default" : "outline"}>
                        v{v.version}
                      </Badge>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Prompt content is file-authored (apps/ai/prompts/&lt;name&gt;/v&lt;N&gt;.md) -- this reflects which versions
          have been used, read-only. &ldquo;Drift&rdquo; means a file was edited without bumping its version number;
          it self-heals the next time that prompt is used.
        </p>
      </CardContent>
    </Card>
  );
}

function AiProviderHealthSection() {
  const { data, isLoading, isError, error } = useProviderHealth();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Provider Health</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryError error={error} />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data?.providers.map((p) => (
              <li key={p.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 capitalize">
                  {p.name}
                  {p.name === data.primaryProvider ? <Badge variant="secondary">primary</Badge> : null}
                  {p.name === data.fallbackProvider ? <Badge variant="outline">fallback</Badge> : null}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={p.configured ? "outline" : "secondary"} className={p.configured ? "border-emerald-500 text-emerald-600" : ""}>
                    {p.configured ? "configured" : "not configured"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      p.circuitBreakerState === "closed"
                        ? "border-emerald-500 text-emerald-600"
                        : p.circuitBreakerState === "half_open"
                          ? "border-amber-500 text-amber-600"
                          : "border-destructive text-destructive"
                    }
                  >
                    {p.circuitBreakerState}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Reflects configuration + live circuit-breaker state only -- never makes a real (billed) call to a provider
          just to answer a health check.
        </p>
      </CardContent>
    </Card>
  );
}

function AiUsageSection() {
  const { data, isLoading, isError, error } = useAiUsage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Cost &amp; Token Usage</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryError error={error} />
        ) : !data || data.totals.generations === 0 ? (
          <p className="text-sm text-muted-foreground">No AI generations recorded yet.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-lg font-bold">{data.totals.generations}</div>
                <div className="text-xs text-muted-foreground">generations</div>
              </div>
              <div>
                <div className="text-lg font-bold">{data.totals.totalTokens.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">tokens</div>
              </div>
              <div>
                <div className="text-lg font-bold">${data.totals.estimatedCostUsd.toFixed(4)}</div>
                <div className="text-xs text-muted-foreground">estimated cost</div>
              </div>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.byProviderAndStage.map((row) => (
                <li key={`${row.provider}-${row.stage}`} className="flex justify-between">
                  <span>
                    {row.provider} / {row.stage}
                  </span>
                  <span>
                    {row.generations}x, {row.totalTokens.toLocaleString()} tok, ${row.estimatedCostUsd.toFixed(4)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
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
          <AiProviderHealthSection />
          <AiUsageSection />
        </div>
      </div>
    </div>
  );
}
