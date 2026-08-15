import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch a rejected promise returned from an async
 * route handler — an uncaught rejection like that is an unhandled
 * rejection, and Node terminates the process on those by default. That's
 * exactly what killed the server on a dropped Prisma connection: a
 * `throw` or a failed `await prisma...` deep in a route with nothing
 * downstream to catch it. Wrapping every handler in this forwards the
 * rejection to next(err) instead, so it reaches errorHandler.ts and
 * becomes an HTTP 500 rather than a dead server.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
