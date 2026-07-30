import { Request, Response } from "express";

export type ErrorCode =
  | "invalid_body"
  | "invalid_query"
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "provider_unavailable"
  | "creator_not_found"
  | "internal_error";

/**
 * Every error response uses this one envelope -- see apps/backend's
 * docs/API.md "Standard error format" for the shared rationale across
 * services.
 */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown
): void {
  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: (req as any).id,
    },
  });
}
