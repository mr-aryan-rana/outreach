import { createHash, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { sendError } from "./errors";

export const API_KEY_HEADER = "x-api-key";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(hashApiKey(a));
  const bufB = Buffer.from(hashApiKey(b));
  return timingSafeEqual(bufA, bufB);
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header(API_KEY_HEADER);
  if (!provided) {
    return sendError(req, res, 401, "unauthorized", `missing ${API_KEY_HEADER} header`);
  }

  const matched = env.apiKeys.find((key) => safeEquals(key, provided));
  if (!matched) {
    return sendError(req, res, 401, "unauthorized", "invalid API key");
  }

  (req as any).apiKeyId = hashApiKey(matched).slice(0, 12);
  next();
}
