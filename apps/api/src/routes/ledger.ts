import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get(
  "/ledger",
  asyncHandler(async (_req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: DEMO_USER_ID },
      orderBy: { createdAt: "desc" },
    });
    res.json({ entries });
  })
);

export default router;
