import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./config/env";

export const REQUEST_ID_HEADER = "x-request-id";

// Same redaction as apps/backend and apps/ai -- see docs/SECURITY.md.
export const LOG_REDACT_PATHS = [
  'req.headers["x-api-key"]',
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: env.logLevel,
  redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" },
});

export function requestIdFromHeaders(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value || randomUUID();
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: requestIdFromHeaders,
  customProps: (req) => ({ requestId: (req as any).id }),
});
