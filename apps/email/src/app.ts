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
import { campaignsRouter } from "./routes/campaigns";
import { creatorsRouter } from "./routes/creators";
import { dashboardRouter } from "./routes/dashboard";
import { emailEventsRouter } from "./routes/emailEvents";
import { buildHealthRouter } from "./routes/health";
import { senderProfilesRouter } from "./routes/senderProfiles";
import { suppressionRouter } from "./routes/suppression";
import { webhooksRouter } from "./routes/webhooks";
import { httpRequestDuration, registry } from "./services/metrics";

export interface AppDeps {
  redis: Redis;
}

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

  app.use(buildHealthRouter(prisma, deps.redis));
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  // Single general (per-IP) rate limiter shared by both sub-routers below --
  // found live during this sprint's own test run: mounting a *second*,
  // separate buildGeneralRateLimiter() instance for the v1 router (in
  // addition to this one) double-counted every non-webhook request against
  // the same IP bucket (express-rate-limit's own ERR_ERL_DOUBLE_COUNT
  // guard caught it). One instance, applied once, for the whole /api/v1
  // prefix.
  const api = express.Router();
  api.use(buildGeneralRateLimiter(deps.redis));

  // Webhooks are provider-called, not human/API-key-called -- authenticated
  // by their own shared-secret token (see routes/webhooks.ts), not the
  // apiKeyAuth used for everything else. Mounted before the v1 auth
  // middleware for that reason, but under the same general rate limiter above.
  api.use(webhooksRouter);

  const v1 = express.Router();
  v1.use(apiKeyAuth);
  v1.use(buildApiKeyRateLimiter(deps.redis));
  v1.use(campaignsRouter);
  v1.use(creatorsRouter);
  v1.use(emailEventsRouter);
  v1.use(senderProfilesRouter);
  v1.use(suppressionRouter);
  v1.use(dashboardRouter);
  api.use(v1);

  app.use("/api/v1", api);

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
