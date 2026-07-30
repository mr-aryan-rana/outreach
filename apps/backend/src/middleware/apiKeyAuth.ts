import { createHash, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { sendError } from "./errors";

export const API_KEY_HEADER = "x-api-key";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  // Compare fixed-length digests, not the raw keys themselves: raw keys can
  // differ in length (leaking length via early-return comparisons), digests
  // are always 32 bytes so timingSafeEqual's own length check never leaks
  // anything about the candidate key.
  const bufA = Buffer.from(hashApiKey(a));
  const bufB = Buffer.from(hashApiKey(b));
  return timingSafeEqual(bufA, bufB);
}

/**
 * Applies to every /api/v1/* route. Accepted keys come from API_KEYS (see
 * config/env.ts) -- comma-separated so a rotation is: add the new key,
 * deploy, wait for callers to switch, remove the old key, deploy again.
 * Never logs the raw key on failure, only whether one was presented.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header(API_KEY_HEADER);
  if (!provided) {
    return sendError(req, res, 401, "unauthorized", `missing ${API_KEY_HEADER} header`);
  }

  const matched = env.apiKeys.find((key) => safeEquals(key, provided));
  if (!matched) {
    return sendError(req, res, 401, "unauthorized", "invalid API key");
  }

  // Downstream code (per-key rate limiting, logs) identifies the caller by
  // this short hash prefix, never the raw key -- see docs/SECURITY.md
  // "never log secrets".
  (req as any).apiKeyId = hashApiKey(matched).slice(0, 12);
  next();
}
