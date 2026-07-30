import { Request, Response } from "express";

export type ErrorCode =
  | "invalid_body"
  | "invalid_query"
  | "idempotency_in_progress"
  | "service_unavailable"
  | "bad_gateway"
  | "rate_limited"
  | "not_found"
  | "unauthorized"
  | "internal_error";

/**
 * Every error response across the API (route handlers, rate limiter, global
 * error middleware) uses this one envelope so clients only need to handle
 * one shape: `{ error: { code, message, details?, requestId? } }`.
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
