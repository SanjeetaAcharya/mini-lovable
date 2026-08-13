export interface TokenPack {
  id: string;
  label: string;
  amountCents: number;
  tokens: number;
}

// Token packs offered at checkout. Prices are dynamic Stripe price_data,
// not pre-created Stripe Price objects — no dashboard setup required.
export const TOKEN_PACKS: TokenPack[] = [
  { id: "starter", label: "Starter — 5,000 tokens", amountCents: 500, tokens: 5000 },
  { id: "plus", label: "Plus — 12,000 tokens", amountCents: 1000, tokens: 12000 },
  { id: "pro", label: "Pro — 30,000 tokens", amountCents: 2000, tokens: 30000 },
];

export function getTokenPack(id: string): TokenPack | undefined {
  return TOKEN_PACKS.find((pack) => pack.id === id);
}
