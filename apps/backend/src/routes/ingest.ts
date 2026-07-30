import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { DuplicateChecker } from "../services/duplicateCheck";
import { IdempotencyService } from "../services/idempotency";
import { ingestStageCounter } from "../services/metrics";
import { Pipeline } from "../services/pipeline";
import { BrokenCircuitError } from "../services/resilience";
import { ingestRunSchema } from "../validation";

const IDEMPOTENCY_HEADER = "idempotency-key";

interface IngestStats {
  requested: number;
  extracted: number;
  validated: number;
  stored: number;
  skippedDuplicates: number;
}

export function buildIngestRouter(duplicateChecker: DuplicateChecker, pipeline: Pipeline, idempotency: IdempotencyService): Router {
  const router = Router();

  router.post("/ingest/run", asyncHandler(async (req, res) => {
    const parsed = ingestRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(req, res, 400, "invalid_body", "invalid body", parsed.error.issues);
    }
    const { niche, platform } = parsed.data;
    const requestId = (req as any).id as string | undefined;
    const log = (req as any).log ?? console;

    const idempotencyKey = req.header(IDEMPOTENCY_HEADER);
    if (idempotencyKey) {
      const check = await idempotency.check(idempotencyKey);
      if (check.state === "completed") {
        return res.json(check.result);
      }
      if (check.state === "in_progress") {
        return sendError(
          req,
          res,
          409,
          "idempotency_in_progress",
          "a request with this Idempotency-Key is already in progress"
        );
      }
    }

    const stats: IngestStats = { requested: 0, extracted: 0, validated: 0, stored: 0, skippedDuplicates: 0 };

    let urls: string[];
    try {
      urls = await pipeline.search(platform, niche, requestId);
    } catch (err) {
      if (idempotencyKey) await idempotency.release(idempotencyKey);
      const isBroken = err instanceof BrokenCircuitError;
      return sendError(
        req,
        res,
        isBroken ? 503 : 502,
        isBroken ? "service_unavailable" : "bad_gateway",
        `search service unavailable: ${(err as Error).message}`
      );
    }
    stats.requested = urls.length;
    ingestStageCounter.labels("requested").inc(urls.length);

    for (const url of urls) {
      const isDuplicateSite = await duplicateChecker.isDuplicateWebsite(url);
      if (isDuplicateSite) {
        stats.skippedDuplicates += 1;
        ingestStageCounter.labels("skipped_duplicate").inc();
        log.info({ event: "skip_duplicate_website", url });
        continue;
      }

      let extracted;
      try {
        extracted = await pipeline.extract(url, requestId);
      } catch (err) {
        log.warn({ event: "extract_failed", url, error: (err as Error).message });
        continue;
      }
      if (!extracted.email) continue;
      stats.extracted += 1;
      ingestStageCounter.labels("extracted").inc();

      const isDuplicateEmail = await duplicateChecker.isDuplicateEmail(extracted.email);
      if (isDuplicateEmail) {
        stats.skippedDuplicates += 1;
        ingestStageCounter.labels("skipped_duplicate").inc();
        log.info({ event: "skip_duplicate_email", url });
        continue;
      }

      let validation;
      try {
        validation = await pipeline.validate(extracted.email, requestId);
      } catch (err) {
        log.warn({ event: "validate_failed", url, error: (err as Error).message });
        continue;
      }
      if (!validation.is_valid) continue;
      stats.validated += 1;
      ingestStageCounter.labels("validated").inc();

      // Includes the query string, not just the path: YouTube's canonical video
      // URL is /watch?v=<id> -- the ID lives in the query string, so a
      // pathname-only handle collapsed every video on the platform to the
      // same "watch" handle and tripped the (handle, platform) unique
      // constraint for every video after the first.
      const { pathname, search } = new URL(url);
      const handle = `${pathname}${search}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || url;

      try {
        await prisma.creator.create({
          data: {
            handle,
            platform,
            niche,
            websiteUrl: url,
            bio: extracted.bio || null,
            socialLinks: extracted.social_links,
            emails: {
              create: {
                address: extracted.email,
                sourceUrl: extracted.source_url,
                validationResult: {
                  create: {
                    isValid: validation.is_valid,
                    confidenceScore: validation.confidence_score,
                    reasons: validation.reasons,
                  },
                },
              },
            },
          },
        });
      } catch (err) {
        // Unique constraint race (email/website inserted between the Redis check and here);
        // Postgres's unique constraints are the real guarantee, Redis is just the fast path.
        log.warn({ event: "store_conflict", url, error: (err as Error).message });
        continue;
      }

      await duplicateChecker.markEmailSeen(extracted.email);
      await duplicateChecker.markWebsiteSeen(url);
      stats.stored += 1;
      ingestStageCounter.labels("stored").inc();
    }

    if (idempotencyKey) await idempotency.complete(idempotencyKey, stats);
    res.json(stats);
  }));

  return router;
}
