import type { HistoryPurchase, LedgerEntry, TokenPack } from "./api";

/** "Aug 15, 22:35" — compact, and stable width in a monospace column. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Turns a raw LedgerEntryType into something readable, naming the token
 * pack for purchases where it can be resolved. The ledger entry only
 * carries a purchaseId, so the pack is recovered by matching the linked
 * purchase's token count against the configured packs.
 */
export function ledgerLabel(
  entry: LedgerEntry,
  purchases: HistoryPurchase[],
  packs: TokenPack[]
): string {
  switch (entry.type) {
    case "CREDIT_PURCHASE": {
      const purchase = entry.purchaseId
        ? purchases.find((p) => p.id === entry.purchaseId)
        : undefined;
      const pack = purchase ? packs.find((p) => p.tokens === purchase.tokensPurchased) : undefined;
      const name = pack ? pack.id.charAt(0).toUpperCase() + pack.id.slice(1) : null;
      return name ? `Token purchase · ${name}` : "Token purchase";
    }
    case "DEBIT_GENERATION":
      return "Generation usage";
    case "DEBIT_DEPLOYMENT":
      return "Deploy fee";
    default:
      return entry.type;
  }
}

/**
 * Deployment URLs embed a generation id and a Vercel build hash, so they
 * are far too long to sit in a table cell. Shows the host with the middle
 * elided; the full URL stays in the link target and the title attribute.
 */
export function shortenUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  if (host.length <= 34) return host;
  return `${host.slice(0, 18)}…${host.slice(-12)}`;
}

/**
 * Rough "how much runway is left" figure for the billing screen, derived
 * from what recent generations actually cost rather than a guess. Returns
 * null when there is nothing charged yet to average over.
 */
export function estimateGenerationsRemaining(
  balance: number,
  recentCharges: number[]
): number | null {
  const charges = recentCharges.filter((c) => c > 0).slice(0, 10);
  if (charges.length === 0) return null;
  const average = charges.reduce((sum, c) => sum + c, 0) / charges.length;
  if (average <= 0) return null;
  return Math.floor(balance / average);
}
