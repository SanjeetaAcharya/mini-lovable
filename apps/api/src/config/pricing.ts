export interface TokenPack {
  id: string;
  label: string;
  amountCents: number;
  tokens: number;
}

// Token packs offered at checkout. Prices are dynamic Stripe price_data,
// not pre-created Stripe Price objects — no dashboard setup required.
export const TOKEN_PACKS: TokenPack[] = [
  // `label` is the line-item name shown on the Stripe Checkout page. The
  // app's own buy buttons compose their text from `tokens`/`amountCents`
  // instead, so the price is visible before the user leaves the page.
  { id: "starter", label: "Starter · 5,000 tokens", amountCents: 500, tokens: 5000 },
  { id: "plus", label: "Plus · 12,000 tokens", amountCents: 1000, tokens: 12000 },
  { id: "pro", label: "Pro · 30,000 tokens", amountCents: 2000, tokens: 30000 },
];

export function getTokenPack(id: string): TokenPack | undefined {
  return TOKEN_PACKS.find((pack) => pack.id === id);
}

// --- Generation pricing --------------------------------------------------
//
// Internal tokens are this app's own currency — the unit LedgerEntry.amount
// and Purchase.tokensPurchased are both denominated in. The peg below ties
// that currency to real dollars via the starter pack's list price (5000
// tokens for $5 = 1000 internal tokens per USD). The bigger packs above are
// a volume discount on the *purchase* side; the rate used to price what a
// generation *costs* is always this base peg, not a per-pack rate.
export const INTERNAL_TOKENS_PER_USD = 1000;

// What we'd pay OpenRouter per 1000 LLM tokens (prompt + completion
// combined) if the configured model weren't free. Modeled loosely on a
// small/mid-tier hosted model (roughly $10 per 1M tokens, blended). This
// constant only comes into play when OpenRouter reports a real cost of $0
// or omits it entirely — which is every request against a `:free` model —
// so the usage -> cost -> internal-token conversion stays real and
// testable even though the dollar amount underneath is synthetic. A paid
// model's real reported cost is always preferred when it's > 0.
export const SYNTHETIC_PRICE_PER_1K_LLM_TOKENS_USD = 0.01;

// Margin charged on top of raw inference cost (real or synthetic). 1.5 =
// a 50% markup — a fairly ordinary SaaS-on-top-of-API margin.
export const MARKUP_MULTIPLIER = 1.5;

// A generation is never free, even a trivial one.
export const MIN_GENERATION_CHARGE_TOKENS = 1;

// Conservative ceiling on what a single generation could ever cost,
// enforced as a pre-flight balance gate *before* calling the LLM at all
// — so we never spend real OpenRouter usage on a request we already know
// we can't bill for. Derived from the hard caps enforced elsewhere: a
// ~2000-character prompt (~500 tokens) + the system prompt (~200 tokens)
// + MAX_COMPLETION_TOKENS on the OpenRouter request (8000 completion
// tokens) is ~8700 tokens worst case, which prices out to ~131 internal
// tokens at the rates above. Rounded up with headroom.
//
// Moves in lockstep with MAX_COMPLETION_TOKENS in services/llm.service.ts
// — that cap went 2000 -> 8000 to stop truncating responses mid-JSON, so
// worst-case spend per generation roughly tripled and this gate has to
// cover it. A generation that retries spends two calls, but only the
// surviving attempt is ever billed, so one call's worth is the right
// reservation.
export const MIN_BALANCE_FOR_GENERATION = 180;

// --- Deployment pricing ---------------------------------------------------
//
// Deploying is a flat fee, not usage-metered: Vercel's deployment API
// doesn't report a per-request cost the way OpenRouter does, and a deploy
// is a single discrete action (push these exact already-generated files
// live) rather than a variable-length piece of LLM inference. Denominated
// in the same internal-token currency via INTERNAL_TOKENS_PER_USD, chosen
// small relative to a typical generation's charge.
export const DEPLOYMENT_FEE_TOKENS = 20;

export interface LlmUsageForPricing {
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

/**
 * Converts OpenRouter usage into the internal tokens to debit from a
 * user's balance for one generation. Prefers the real reported cost;
 * falls back to the synthetic per-1K-token price when the model reports
 * $0 or no cost at all.
 */
export function usageToInternalTokens(usage: LlmUsageForPricing): number {
  const totalTokens = usage.promptTokens + usage.completionTokens;
  const costUsd =
    usage.costUsd && usage.costUsd > 0
      ? usage.costUsd
      : (totalTokens / 1000) * SYNTHETIC_PRICE_PER_1K_LLM_TOKENS_USD;

  const charged = Math.ceil(costUsd * INTERNAL_TOKENS_PER_USD * MARKUP_MULTIPLIER);
  return Math.max(MIN_GENERATION_CHARGE_TOKENS, charged);
}
