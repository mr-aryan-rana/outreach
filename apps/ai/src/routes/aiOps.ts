import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { env, ProviderName } from "../config/env";
import { getCircuitState } from "../providers/resilience";
import { listPromptNames, loadPromptVersions } from "../prompts/promptLoader";
import { usageQuerySchema } from "../validation";

/**
 * Production-readiness endpoints added in Sprint 6: provider health,
 * cost/token usage accounting, and prompt-version drift verification. Split
 * from routes/ai.ts (the drafting pipeline itself) since these are
 * operational/ops-facing, not part of the generation pipeline.
 */
export const aiOpsRouter = Router();

const PROVIDER_NAMES: ProviderName[] = ["openai", "anthropic", "gemini", "mock"];
const KEY_CONFIGURED: Record<ProviderName, boolean | (() => boolean)> = {
  openai: () => !!env.openaiApiKey,
  anthropic: () => !!env.anthropicApiKey,
  gemini: () => !!env.geminiApiKey,
  mock: true,
};

// Added for apps/admin's Settings page and general ops visibility. Reports
// *configuration* + circuit-breaker state, not a live connectivity probe --
// deliberately never makes a real (billed) call to a provider just to
// answer a health check. A configured-but-actually-broken key will still
// show "configured", but its circuit breaker will trip to "open" on the
// first real failure and show up here within the same request cycle that
// caused it.
aiOpsRouter.get(
  "/ai/providers/health",
  asyncHandler(async (_req, res) => {
    res.json({
      primaryProvider: env.primaryProvider,
      fallbackProvider: env.fallbackProvider,
      providers: PROVIDER_NAMES.map((name) => {
        const configuredCheck = KEY_CONFIGURED[name];
        const configured = typeof configuredCheck === "function" ? configuredCheck() : configuredCheck;
        return {
          name,
          configured,
          circuitBreakerState: getCircuitState(name),
        };
      }),
    });
  })
);

// Aggregate cost/token accounting over apps/ai/prisma/schema.prisma's
// ai_generations table (already recorded per-call since Sprint 3 -- this is
// the first endpoint to *summarize* it). Added for apps/admin's Settings
// page and finance/ops visibility into real spend.
aiOpsRouter.get(
  "/ai/usage",
  asyncHandler(async (req, res) => {
    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_query", "invalid query", parsed.error.issues);
    }
    const { since, until, provider } = parsed.data;

    const where: Record<string, unknown> = {};
    if (since || until) {
      where.createdAt = { ...(since ? { gte: new Date(since) } : {}), ...(until ? { lte: new Date(until) } : {}) };
    }
    if (provider) where.provider = provider;

    const grouped = await prisma.aiGeneration.groupBy({
      by: ["provider", "stage"],
      where,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
      _count: { _all: true },
      _avg: { latencyMs: true },
    });
    const fallbackCount = await prisma.aiGeneration.count({ where: { ...where, usedFallback: true } });

    const totals = grouped.reduce(
      (acc, row) => {
        acc.totalTokens += row._sum.totalTokens ?? 0;
        acc.estimatedCostUsd += row._sum.estimatedCostUsd ?? 0;
        acc.generations += row._count._all;
        return acc;
      },
      { totalTokens: 0, estimatedCostUsd: 0, generations: 0 }
    );

    res.json({
      range: { since: since ?? null, until: until ?? null },
      totals: { ...totals, estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(6)), fallbackUsedCount: fallbackCount },
      byProviderAndStage: grouped.map((row) => ({
        provider: row.provider,
        stage: row.stage,
        generations: row._count._all,
        promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        estimatedCostUsd: Number((row._sum.estimatedCostUsd ?? 0).toFixed(6)),
        avgLatencyMs: row._avg.latencyMs !== null ? Math.round(row._avg.latencyMs) : null,
      })),
    });
  })
);

// "Prompt version verification": compares each prompt's file-authored
// content (source of truth, prompts/<name>/v<N>.md) against what's recorded
// in prompt_versions for that same version number. They're expected to
// always match -- resolveAndRenderPrompt() (promptService.ts) self-heals
// drift the next time that prompt is actually used, but this lets an
// operator *see* drift proactively rather than only discovering it via a
// pipeline run. Drift means someone edited a prompt file without bumping
// its version number (a process mistake, not a supported flow).
aiOpsRouter.get(
  "/ai/prompts/verify",
  asyncHandler(async (_req, res) => {
    const names = listPromptNames();
    const results = await Promise.all(
      names.map(async (name) => {
        const fileVersions = loadPromptVersions(name);
        const dbTemplate = await prisma.promptTemplate.findUnique({
          where: { name },
          include: { versions: true },
        });

        const versions = fileVersions.map((fileVersion) => {
          const dbVersion = dbTemplate?.versions.find((v) => v.version === fileVersion.version);
          return {
            version: fileVersion.version,
            syncedToDb: !!dbVersion,
            driftDetected: !!dbVersion && dbVersion.content !== fileVersion.content,
          };
        });

        return {
          name,
          latestFileVersion: fileVersions[fileVersions.length - 1]?.version ?? null,
          versions,
          hasDrift: versions.some((v) => v.driftDetected),
        };
      })
    );

    res.json({ items: results, anyDrift: results.some((r) => r.hasDrift) });
  })
);
