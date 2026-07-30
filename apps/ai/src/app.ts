import cors from "cors";
import express, { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
import Redis from "ioredis";
import { env } from "./config/env";
import { prisma } from "./db";
import { REQUEST_ID_HEADER, httpLogger } from "./logger";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { sendError } from "./middleware/errors";
import { buildApiKeyRateLimiter, buildGeneralRateLimiter } from "./middleware/rateLimit";
import { aiRouter } from "./routes/ai";
import { buildHealthRouter } from "./routes/health";
import { httpRequestDuration, registry } from "./services/metrics";

export interface AppDeps {
  redis: Redis;
}

/**
 * Mirrors apps/backend/src/app.ts's middleware stack (Helmet, deny-by-default
 * CORS, structured logging with secret redaction, standard error envelope,
 * per-IP then per-key rate limiting) -- same operational posture, same
 * lessons already learned there, applied here from the start rather than
 * found-and-fixed later.
 */
export function buildApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(cors(env.corsAllowedOrigins.length > 0 ? { origin: env.corsAllowedOrigins } : { origin: false }));

  app.use(httpLogger);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader(REQUEST_ID_HEADER, (req as any).id);
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.labels(req.method, req.route?.path ?? req.path, String(res.statusCode)).observe(durationSeconds);
    });
    next();
  });

  // Unversioned, same convention as apps/backend.
  app.use(buildHealthRouter(prisma, deps.redis));
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  const v1 = express.Router();
  v1.use(buildGeneralRateLimiter(deps.redis));
  v1.use(apiKeyAuth);
  v1.use(buildApiKeyRateLimiter(deps.redis));
  v1.use(aiRouter);
  app.use("/api/v1", v1);

  app.use((req: Request, res: Response) => {
    sendError(req, res, 404, "not_found", `no route for ${req.method} ${req.path}`);
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const log = (req as any).log ?? console;
    log.error({ event: "unhandled_route_error", error: err.message, stack: err.stack });
    if (res.headersSent) return;
    sendError(req, res, 500, "internal_error", "internal server error");
  });

  return app;
}
