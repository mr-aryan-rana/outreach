import { Request, Response } from "express";

export type ErrorCode =
  | "invalid_body"
  | "invalid_query"
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "invalid_state_transition"
  | "recipient_suppressed"
  | "internal_error";

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
