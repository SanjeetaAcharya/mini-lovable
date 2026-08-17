import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { getTokenPack } from "../config/pricing";
import { appendEntry } from "./ledger.service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Trailing slash stripped defensively: an easy env var typo (or a
// platform's dashboard auto-appending one) would otherwise produce a
// double slash in success_url/cancel_url ("vercel.app//purchase/success"),
// which the frontend's exact pathname check on return wouldn't match.
const CLIENT_URL = (process.env.CLIENT_URL ?? "http://localhost:5173").replace(/\/+$/, "");

export class UnknownTokenPackError extends Error {
  constructor(packId: string) {
    super(`Unknown token pack: ${packId}`);
    this.name = "UnknownTokenPackError";
  }
}

/**
 * Creates a Stripe Checkout Session for a token pack and records a matching
 * Purchase row up front (status PENDING) so the webhook has something to
 * look up by session id when payment completes.
 */
export async function createCheckoutSession(userId: string, packId: string) {
  const pack = getTokenPack(packId);
  if (!pack) {
    throw new UnknownTokenPackError(packId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: pack.label },
          unit_amount: pack.amountCents,
        },
        quantity: 1, 
      },
    ],
    success_url: `${CLIENT_URL}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${CLIENT_URL}/purchase/cancelled`,
    metadata: { userId, packId },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  await prisma.purchase.create({
    data: {
      userId,
      stripeSessionId: session.id,
      amountCents: pack.amountCents,
      tokensPurchased: pack.tokens,
      status: "PENDING",
    },
  });

  return { url: session.url, sessionId: session.id };
}

export function constructWebhookEvent(payload: Buffer, signature: string) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}

/**
 * Credits the ledger for a completed checkout session. Idempotent: a
 * conditional update (status PENDING -> PAID) acts as a compare-and-swap,
 * so only the delivery that wins the race proceeds to append a ledger
 * entry. Purchase.stripeSessionId and LedgerEntry.purchaseId are both
 * unique, so even a bug in that guard can't produce a double credit.
 */
export async function creditPurchaseFromSession(session: Stripe.Checkout.Session) {
  const purchase = await prisma.purchase.findUnique({
    where: { stripeSessionId: session.id },
  });

  if (!purchase) {
    console.error(`Webhook received for unknown checkout session: ${session.id}`);
    return;
  }

  if (purchase.status === "PAID") {
    console.log(`Purchase ${purchase.id} already credited — ignoring duplicate webhook`);
    return;
  }

  const claimed = await prisma.purchase.updateMany({
    where: { id: purchase.id, status: "PENDING" },
    data: { status: "PAID" },
  });

  if (claimed.count === 0) {
    // Lost the race to another concurrent delivery of the same event.
    console.log(`Purchase ${purchase.id} claimed by a concurrent webhook — skipping`);
    return;
  }

  try {
    await appendEntry({
      userId: purchase.userId,
      type: "CREDIT_PURCHASE",
      amount: purchase.tokensPurchased,
      purchaseId: purchase.id,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Ledger entry for this purchase already exists — treat as already credited.
      console.log(`Ledger entry for purchase ${purchase.id} already exists — ignoring`);
      return;
    }
    throw err;
  }

  // Invoice number is derived from the purchase id rather than a separate
  // counter — it's already guaranteed unique, so there's nothing extra to
  // coordinate. Non-fatal on failure: the balance is already correctly
  // credited (the part that matters), and a missing invoice for the rare
  // crash-between-credit-and-here case can be regenerated later rather
  // than risking the credited money on an invoice-row failure.
  try {
    await prisma.invoice.create({
      data: {
        purchaseId: purchase.id,
        invoiceNumber: `INV-${purchase.id}`,
        amountCents: purchase.amountCents,
      },
    });
  } catch (err) {
    console.error(`Failed to create invoice for purchase ${purchase.id}:`, err);
  }
}
