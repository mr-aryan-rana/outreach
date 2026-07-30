import cors from "cors";
import express, { Express, NextFunction, Request, Response } from "express";
import fs from "fs";
import helmet from "helmet";
import Redis from "ioredis";
import path from "path";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";
import { env } from "./config/env";
import { prisma } from "./db";
import { REQUEST_ID_HEADER, httpLogger, logger } from "./logger";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { sendError } from "./middleware/errors";
import { buildApiKeyRateLimiter, buildGeneralRateLimiter, buildIngestRateLimiter } from "./middleware/rateLimit";
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

function loadOpenApiDocument(): object | undefined {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "openapi.yaml"), "utf8");
    return yaml.load(raw) as object;
  } catch (err) {
    // Docs are a convenience, not a runtime dependency -- never let a
    // missing/unparseable spec file take the whole app down.
    logger.warn({ event: "openapi_load_failed", error: (err as Error).message });
    return undefined;
  }
}

export function buildApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());

  // No auth layer yet (docs/SECURITY.md) -- deny cross-origin browser access
  // by default. Set CORS_ALLOWED_ORIGINS (comma-separated) once a real
  // frontend origin exists.
  app.use(
    cors(
      env.corsAllowedOrigins.length > 0
        ? { origin: env.corsAllowedOrigins }
        : { origin: false }
    )
  );

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

  const openApiDocument = loadOpenApiDocument();
  if (openApiDocument) {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  // All /api/v1/* routes are private: general IP-based flood protection
  // first (cheap, applies even to unauthenticated/brute-force traffic),
  // then API key auth, then a per-key quota on top of the per-IP one (see
  // config/env.ts apiKeyRateLimitMax and docs/API.md "Authentication").
  const v1 = express.Router();
  v1.use(buildGeneralRateLimiter(deps.redis));
  v1.use(apiKeyAuth);
  v1.use(buildApiKeyRateLimiter(deps.redis));
  v1.use(creatorsRouter);
  v1.use("/ingest", buildIngestRateLimiter(deps.redis));
  v1.use(buildIngestRouter(deps.duplicateChecker, deps.pipeline, deps.idempotency));
  app.use("/api/v1", v1);

  app.use((req: Request, res: Response) => {
    sendError(req, res, 404, "not_found", `no route for ${req.method} ${req.path}`);
  });

  // Must be last, and must have all 4 params for Express to recognize it as
  // an error handler. Without this, any error reaching here via asyncHandler
  // would otherwise still crash the process on an unhandled rejection.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const log = (req as any).log ?? console;
    log.error({ event: "unhandled_route_error", error: err.message, stack: err.stack });
    if (res.headersSent) return;
    sendError(req, res, 500, "internal_error", "internal server error");
  });

  return app;
}
