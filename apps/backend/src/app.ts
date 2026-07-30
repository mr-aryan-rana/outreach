import cors from "cors";
import express, { Express, NextFunction, Request, Response } from "express";
import Redis from "ioredis";
import { prisma } from "./db";
import { REQUEST_ID_HEADER, httpLogger } from "./logger";
import { buildGeneralRateLimiter, buildIngestRateLimiter } from "./middleware/rateLimit";
import { creatorsRouter } from "./routes/creators";
import { buildHealthRouter } from "./routes/health";
import { buildIngestRouter } from "./routes/ingest";
import { DuplicateChecker } from "./services/duplicateCheck";
import { IdempotencyService } from "./services/idempotency";
import { registry, httpRequestDuration } from "./services/metrics";
import { Pipeline } from "./services/pipeline";

export interface AppDeps {
  redis: Redis;
  duplicateChecker: DuplicateChecker;
  pipeline: Pipeline;
  idempotency: IdempotencyService;
}

export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(httpLogger);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader(REQUEST_ID_HEADER, (req as any).id);
    next();
  });
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.labels(req.method, req.route?.path ?? req.path, String(res.statusCode)).observe(durationSeconds);
    });
    next();
  });

  // Unversioned: infra probes and metrics scrapers should never need to track API version.
  app.use(buildHealthRouter(prisma, deps.redis));
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  const v1 = express.Router();
  v1.use(buildGeneralRateLimiter(deps.redis));
  v1.use(creatorsRouter);
  v1.use("/ingest", buildIngestRateLimiter(deps.redis));
  v1.use(buildIngestRouter(deps.duplicateChecker, deps.pipeline, deps.idempotency));
  app.use("/api/v1", v1);

  // Must be last, and must have all 4 params for Express to recognize it as
  // an error handler. Without this, any error reaching here via asyncHandler
  // would otherwise still crash the process on an unhandled rejection.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const log = (req as any).log ?? console;
    log.error({ event: "unhandled_route_error", error: err.message, stack: err.stack });
    if (res.headersSent) return;
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
