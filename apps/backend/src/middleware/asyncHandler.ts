import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch rejected promises returned from async route
 * handlers -- an unhandled rejection there crashes the whole process (Node
 * terminates on unhandled rejection by default). Wrap every async handler
 * with this so unexpected errors reach the error-handling middleware instead
 * of taking the process down.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
