import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./config/env";

export const REQUEST_ID_HEADER = "x-request-id";

// pino-http's default req serializer logs every request header verbatim --
// confirmed by direct test to include `x-api-key` in plaintext on every
// authenticated request, contradicting the "never log headers/bodies
// wholesale" policy (docs/SECURITY.md). Redact rather than drop entirely:
// the field staying present (as "[Redacted]") still shows a key was sent,
// useful for debugging auth issues, without leaking its value. Exported so
// tests/hardening.test.ts can verify this doesn't regress without
// duplicating the path list.
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
