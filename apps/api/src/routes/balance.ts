import { Router } from "express";
import { getBalance } from "../services/ledger.service";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get(
  "/balance",
  asyncHandler(async (_req, res) => {
    const balance = await getBalance(DEMO_USER_ID);
    res.json({ balance });
  })
);

export default router;