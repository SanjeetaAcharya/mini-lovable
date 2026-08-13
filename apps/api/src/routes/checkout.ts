import { Router } from "express";
import { createCheckoutSession, UnknownTokenPackError } from "../services/stripe.service";
import { TOKEN_PACKS } from "../config/pricing";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get("/checkout/packs", (_req, res) => {
  res.json({ packs: TOKEN_PACKS });
});

router.post("/checkout", async (req, res) => {
  const { packId } = req.body ?? {};
  if (typeof packId !== "string") {
    res.status(400).json({ error: "packId is required" });
    return;
  }

  try {
    const { url } = await createCheckoutSession(DEMO_USER_ID, packId);
    res.json({ url });
  } catch (err) {
    if (err instanceof UnknownTokenPackError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

export default router;
