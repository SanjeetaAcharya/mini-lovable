import { Router } from "express";
import express from "express";
import Stripe from "stripe";
import { constructWebhookEvent, creditPurchaseFromSession } from "../services/stripe.service";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// Stripe signature verification needs the exact raw request bytes, so this
// route gets its own body parser instead of the app-wide express.json().
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(req.body as Buffer, signature);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await creditPurchaseFromSession(session);
    }
    res.json({ received: true });
  })
);

export default router;
