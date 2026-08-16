import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getBalance, reconstructBalance } from "../services/ledger.service";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get(
  "/ledger",
  asyncHandler(async (_req, res) => {
    // The two balances are computed by different routes on purpose:
    // `balance` reads the running-balance snapshot off the newest entry,
    // `reconstructed` sums every entry from scratch. Returning both on
    // each request means the "balance is reconstructable from history
    // alone" claim is exercised in production rather than asserted in a
    // README — if the snapshot ever drifts from the sum, `agrees` goes
    // false here instead of the drift going unnoticed.
    const [entries, balance, reconstructed] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { userId: DEMO_USER_ID },
        orderBy: { createdAt: "desc" },
      }),
      getBalance(DEMO_USER_ID),
      reconstructBalance(DEMO_USER_ID),
    ]);

    if (balance !== reconstructed) {
      console.error(
        `Ledger reconciliation failed for user ${DEMO_USER_ID}: ` +
          `snapshot ${balance} != sum of entries ${reconstructed}`
      );
    }

    res.json({
      entries,
      reconciliation: { balance, reconstructed, agrees: balance === reconstructed },
    });
  })
);

export default router;
