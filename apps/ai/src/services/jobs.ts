import { prisma } from "../db";
import { GenerationOutcome } from "../providers/registry";
import { estimateCostUsd } from "../providers/types";
import { aiEstimatedCostUsdTotal, aiTokensTotal } from "./metrics";

export type JobType = "summary" | "brand_fit" | "draft";

export async function createJob(creatorId: string, jobType: JobType, input: unknown) {
  return prisma.aiJob.create({
    data: { creatorId, jobType, status: "processing", input: input as any },
  });
}

export async function completeJob(jobId: string, result: unknown) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "completed", result: result as any, completedAt: new Date() },
  });
}

export async function failJob(jobId: string, error: string) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "failed", error, completedAt: new Date() },
  });
}

/**
 * Requirement #6: every generation records model, provider, prompt_version,
 * latency, token_usage, estimated_cost, created_at (created_at is
 * @default(now()) on the model). Also feeds the same numbers into
 * ai_tokens_total / ai_estimated_cost_usd_total so they're queryable both as
 * a per-generation audit row (Postgres) and as an aggregate trend
 * (Prometheus) -- see monitoring/ in apps/backend for the equivalent
 * pattern.
 */
export async function recordGeneration(params: {
  jobId: string;
  stage: string;
  outcome: GenerationOutcome;
  promptVersionId: string | undefined;
}) {
  const { jobId, stage, outcome, promptVersionId } = params;
  const { result, provider, usedFallback, latencyMs } = outcome;
  const estimatedCostUsd = estimateCostUsd(result.model, result.promptTokens, result.completionTokens);

  if (result.promptTokens !== undefined) aiTokensTotal.labels(provider, stage, "prompt").inc(result.promptTokens);
  if (result.completionTokens !== undefined)
    aiTokensTotal.labels(provider, stage, "completion").inc(result.completionTokens);
  if (estimatedCostUsd !== undefined) aiEstimatedCostUsdTotal.labels(provider, stage).inc(estimatedCostUsd);

  return prisma.aiGeneration.create({
    data: {
      jobId,
      stage,
      provider,
      model: result.model,
      promptVersionId,
      latencyMs: Math.round(latencyMs),
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      estimatedCostUsd,
      usedFallback,
      output: { text: result.text } as any,
    },
  });
}
