import { PrismaClient } from "@prisma/client";

// Prisma error codes for a transient connection problem, as opposed to a
// real query/data error. Neon's free tier suspends its compute after a
// period of inactivity, so the *first* query after a wake-up can fail
// this way while the compute is still coming back — that's an expected
// cost of the free tier, not an exceptional condition, so it's worth
// retrying rather than surfacing straight to the caller.
const RETRYABLE_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server reached but timed out
  "P1017", // Server has closed the connection
]);
const RETRYABLE_MESSAGE =
  /Server has closed the connection|Can't reach database server|ECONNRESET|Connection terminated/i;

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return RETRYABLE_MESSAGE.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 400;

/**
 * Retries an arbitrary async operation on a transient connection error,
 * with linear backoff. Exported so ledger.service.ts can wrap its whole
 * `$transaction()` call as one unit — a Postgres transaction is atomic,
 * so if it fails before committing, nothing was written, and retrying
 * the entire thing from scratch is safe. This is deliberately NOT used to
 * retry a single statement mid-transaction — see the query extension
 * below for why that's handled differently.
 */
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      attempt += 1;
      if (attempt > MAX_RETRIES || !isRetryable(err)) throw err;
      console.warn(`Transient database error, retrying (${attempt}/${MAX_RETRIES}):`, (err as Error).message);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

const basePrisma = new PrismaClient();

/**
 * The single shared Prisma client for the whole app. (Every route/service
 * used to instantiate its own `new PrismaClient()` — wasteful, and it
 * made this extension impossible to apply consistently.) Extended so
 * every plain query automatically retries a transient connection error
 * instead of throwing straight into the route that happened to run it.
 *
 * Safe with respect to the one interactive transaction in this codebase
 * (ledger.service.ts's appendEntry): a `tx`-scoped operation retried here
 * still executes against that same transaction handle, not as a fresh
 * top-level write, so a mid-transaction retry can't bypass the
 * transaction's atomicity or double-write. That transaction is also
 * wrapped in withRetry() at its call site, so a connection drop that
 * kills the transaction outright (not just one statement inside it) gets
 * retried as a whole new attempt — always safe, since Postgres guarantees
 * a transaction that never committed wrote nothing at all.
 */
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        let attempt = 0;
        for (;;) {
          try {
            return await query(args);
          } catch (err) {
            attempt += 1;
            if (attempt > MAX_RETRIES || !isRetryable(err)) throw err;
            console.warn(
              `Transient database error on ${model}.${operation}, retrying (${attempt}/${MAX_RETRIES}):`,
              (err as Error).message
            );
            await sleep(RETRY_DELAY_MS * attempt);
          }
        }
      },
    },
  },
});
