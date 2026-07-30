import { prisma } from "../db";
import { logger } from "../logger";
import { generateWithFallback } from "../providers/registry";
import { resolveAndRenderPrompt } from "../prompts/promptService";
import { CreatorDetail, fetchCreator } from "./creatorClient";
import { completeJob, createJob, failJob, recordGeneration } from "./jobs";

export interface BrandInput {
  name: string;
  description: string;
  values?: string;
  targetAudience?: string;
}

/**
 * Implements the pipeline from PROJECT.md / the Sprint 3 spec:
 *   Creator -> Creator Summary -> Brand Analysis -> Creator Analysis ->
 *   Brand Fit Score -> Subject Generation -> Email Draft -> Quality Review
 *   -> Save Draft
 * split across 3 endpoints: /summary (stage 1 only), /brand-fit (stages
 * 2-4), /draft (stages 2-8, reusing the same brand-fit logic internally so
 * a single /draft call is self-contained). See docs/ARCHITECTURE.md "AI
 * pipeline" for why /draft doesn't reuse a *stored* brand-fit result: brand
 * info is caller-supplied per request, never persisted as its own entity in
 * this slice, so there's nothing to key a cache off other than re-hashing
 * the brand input -- a reasonable future optimization, not done here.
 */

async function runStage(
  jobId: string,
  stage: string,
  promptName: string,
  variables: Record<string, string>
): Promise<string> {
  const { promptVersionId, rendered, missingVariables } = await resolveAndRenderPrompt(promptName, variables);
  if (missingVariables.length > 0) {
    logger.warn({ event: "prompt_missing_variables", promptName, missingVariables });
  }
  const outcome = await generateWithFallback(stage, { prompt: rendered });
  await recordGeneration({ jobId, stage, outcome, promptVersionId });
  return outcome.result.text.trim();
}

function parseKeyThemes(summaryText: string): string[] {
  const match = summaryText.match(/Key themes:\s*(.+)$/im);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function parseScoreAndText(
  text: string,
  textLabel: string
): { score: number | null; text: string } {
  const scoreMatch = text.match(/Score:\s*([\d.]+)/i);
  const textMatch = new RegExp(`${textLabel}:\\s*(.+)`, "is").exec(text);
  const score = scoreMatch ? Math.max(0, Math.min(1, Number(scoreMatch[1]))) : null;
  return { score, text: textMatch ? textMatch[1].trim() : text };
}

async function getOrCreateCreatorSummary(
  creator: CreatorDetail,
  jobId: string,
  forceRegenerate: boolean
): Promise<string> {
  if (!forceRegenerate) {
    const existing = await prisma.creatorSummary.findUnique({ where: { creatorId: creator.id } });
    if (existing) return existing.summary;
  }

  const text = await runStage(jobId, "creator_summary", "creator-summary", {
    creatorName: creator.handle,
    platform: creator.platform,
    niche: creator.niche,
    bio: creator.bio || "(no bio available)",
    socialLinks: creator.socialLinks.length ? creator.socialLinks.join(", ") : "(none known)",
  });
  const keyThemes = parseKeyThemes(text);
  await prisma.creatorSummary.upsert({
    where: { creatorId: creator.id },
    create: { creatorId: creator.id, summary: text, keyThemes },
    update: { summary: text, keyThemes },
  });
  return text;
}

async function computeBrandFit(
  creator: CreatorDetail,
  brand: BrandInput,
  summaryText: string,
  jobId: string
): Promise<{ brandAnalysis: string; creatorAnalysis: string; fitScore: number | null; fitReasoning: string }> {
  const brandAnalysis = await runStage(jobId, "brand_analysis", "brand-analysis", {
    brandName: brand.name,
    brandDescription: brand.description,
    brandValues: brand.values || "(not specified)",
    targetAudience: brand.targetAudience || "(not specified)",
  });

  const creatorAnalysis = await runStage(jobId, "creator_analysis", "creator-analysis", {
    creatorSummary: summaryText,
    brandAnalysis,
  });

  const scoreText = await runStage(jobId, "brand_fit_score", "brand-fit-score", {
    creatorSummary: summaryText,
    brandAnalysis,
    creatorAnalysis,
  });
  const { score: fitScore, text: fitReasoning } = parseScoreAndText(scoreText, "Reasoning");

  return { brandAnalysis, creatorAnalysis, fitScore, fitReasoning };
}

export async function runSummaryPipeline(creatorId: string, requestId?: string) {
  const creator = await fetchCreator(creatorId, requestId);
  const job = await createJob(creatorId, "summary", { creatorId });
  try {
    const summaryText = await getOrCreateCreatorSummary(creator, job.id, true);
    const summary = await prisma.creatorSummary.findUniqueOrThrow({ where: { creatorId } });
    await completeJob(job.id, { creatorSummaryId: summary.id });
    return { jobId: job.id, summary: { id: summary.id, summary: summaryText, keyThemes: summary.keyThemes } };
  } catch (err) {
    await failJob(job.id, (err as Error).message);
    throw err;
  }
}

export async function runBrandFitPipeline(
  creatorId: string,
  brand: BrandInput,
  requestId?: string,
  forceRegenerateSummary = false
) {
  const creator = await fetchCreator(creatorId, requestId);
  const job = await createJob(creatorId, "brand_fit", { creatorId, brand });
  try {
    const summaryText = await getOrCreateCreatorSummary(creator, job.id, forceRegenerateSummary);
    const fit = await computeBrandFit(creator, brand, summaryText, job.id);
    await completeJob(job.id, fit);
    return { jobId: job.id, creatorSummary: summaryText, ...fit };
  } catch (err) {
    await failJob(job.id, (err as Error).message);
    throw err;
  }
}

export async function runDraftPipeline(
  creatorId: string,
  brand: BrandInput,
  requestId?: string,
  forceRegenerateSummary = false
) {
  const creator = await fetchCreator(creatorId, requestId);
  const job = await createJob(creatorId, "draft", { creatorId, brand });
  try {
    const summaryText = await getOrCreateCreatorSummary(creator, job.id, forceRegenerateSummary);
    const fit = await computeBrandFit(creator, brand, summaryText, job.id);

    const subjectsText = await runStage(job.id, "subject_generation", "subject-generation", {
      creatorName: creator.handle,
      creatorSummary: summaryText,
      brandName: brand.name,
      fitReasoning: fit.fitReasoning,
    });
    const subjects = subjectsText.split("\n").map((s) => s.trim()).filter(Boolean);
    const subject = subjects[0] || `Collaboration opportunity with ${brand.name}`;

    const body = await runStage(job.id, "email_draft", "email-draft", {
      creatorName: creator.handle,
      creatorSummary: summaryText,
      brandName: brand.name,
      brandDescription: brand.description,
      fitReasoning: fit.fitReasoning,
      subject,
    });

    const reviewText = await runStage(job.id, "quality_review", "quality-review", {
      emailSubject: subject,
      emailBody: body,
      creatorName: creator.handle,
      brandName: brand.name,
    });
    const { score: qualityScore, text: qualityNotes } = parseScoreAndText(reviewText, "Notes");

    // Save Draft (final pipeline stage) -- status is always "draft"; this
    // service never sends email, matching the Sprint 3 rules exactly.
    const draft = await prisma.draftEmail.create({
      data: {
        creatorId,
        jobId: job.id,
        subject,
        body,
        brandFitScore: fit.fitScore,
        qualityScore,
        qualityNotes,
        status: "draft",
      },
    });

    const result = {
      draftId: draft.id,
      subject,
      allSubjectOptions: subjects,
      body,
      brandFitScore: fit.fitScore,
      qualityScore,
    };
    await completeJob(job.id, result);
    return { jobId: job.id, draft, fitReasoning: fit.fitReasoning };
  } catch (err) {
    await failJob(job.id, (err as Error).message);
    throw err;
  }
}
