import type { ErrorRequestHandler } from "express";

/**
 * Mounted last, after every route. Anything forwarded here via
 * asyncHandler's next(err) — or a synchronous throw in a non-async
 * handler — lands in this single place instead of crashing the process.
 * Logs the real error server-side; the client only ever sees a generic
 * message, never a stack trace or a raw database error string.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled request error:", err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};
