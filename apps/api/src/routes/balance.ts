import { Router } from "express";
import { getBalance } from "../services/ledger.service";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get("/balance", async (_req, res) => {
  try {
    const balance = await getBalance(DEMO_USER_ID);
    res.json({ balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

export default router;