import type { TokenPack } from "../lib/api";

interface Props {
  balance: number | null;
  packs: TokenPack[];
  onBuy: (packId: string) => void;
  buyingPackId: string | null;
}

function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// The pack's `label` from the API is the descriptive string used for the
// Stripe line item. The button composes its own text from the underlying
// numbers instead, so the price is visible before the user commits.
function packButtonText(pack: TokenPack): string {
  const name = pack.id.charAt(0).toUpperCase() + pack.id.slice(1);
  return `${name} · ${pack.tokens.toLocaleString()} tokens · ${formatUsd(pack.amountCents)}`;
}

export function BalanceBar({ balance, packs, onBuy, buyingPackId }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Balance</div>
        {balance === null ? (
          <div className="mt-1 text-2xl font-medium text-neutral-400">Loading</div>
        ) : (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-neutral-900 tabular-nums">
              {balance.toLocaleString()}
            </span>
            <span className="text-sm text-neutral-500">tokens</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => onBuy(pack.id)}
            disabled={buyingPackId !== null}
            className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
          >
            {buyingPackId === pack.id ? "Redirecting…" : packButtonText(pack)}
          </button>
        ))}
      </div>
    </div>
  );
}
