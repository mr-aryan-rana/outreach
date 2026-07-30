import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./config/env";

export const REQUEST_ID_HEADER = "x-request-id";

// Applied from day one here -- apps/backend learned the hard way
// (docs/SECURITY.md) that pino-http logs every request header verbatim by
// default, which would put X-API-Key (both this service's own and the one
// it sends to the backend) in plaintext in every log line.
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
