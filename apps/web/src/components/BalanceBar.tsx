import type { TokenPack } from "../lib/api";

interface Props {
  balance: number | null;
  packs: TokenPack[];
  onBuy: (packId: string) => void;
  buyingPackId: string | null;
}

export function BalanceBar({ balance, packs, onBuy, buyingPackId }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-6">
      <div>
        <div className="text-sm text-neutral-500">Balance</div>
        <div className="text-2xl font-semibold text-neutral-900">
          {balance === null ? "—" : `${balance.toLocaleString()} tokens`}
        </div>
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
            {buyingPackId === pack.id ? "Redirecting…" : pack.label}
          </button>
        ))}
      </div>
    </div>
  );
}
