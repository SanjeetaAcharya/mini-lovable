import { apiUrl, type History, type TokenPack } from "../lib/api";
import { estimateGenerationsRemaining, formatDateTime, formatUsd } from "../lib/format";

interface Props {
  balance: number | null;
  packs: TokenPack[];
  history: History | null;
  onBuy: (packId: string) => void;
  buyingPackId: string | null;
  loading: boolean;
}

/**
 * The pack with the most tokens per dollar. Computed rather than hardcoded
 * so the badge can't drift out of sync with the prices in the API's
 * pricing config.
 */
function bestValuePackId(packs: TokenPack[]): string | null {
  if (packs.length === 0) return null;
  return packs.reduce((best, pack) =>
    pack.tokens / pack.amountCents > best.tokens / best.amountCents ? pack : best
  ).id;
}

function packName(pack: TokenPack): string {
  return pack.id.charAt(0).toUpperCase() + pack.id.slice(1);
}

export function BillingView({ balance, packs, history, onBuy, buyingPackId, loading }: Props) {
  const bestId = bestValuePackId(packs);
  const purchases = history?.purchases ?? [];

  const remaining =
    balance === null
      ? null
      : estimateGenerationsRemaining(
          balance,
          (history?.generations ?? [])
            .map((g) => g.tokensCharged)
            .filter((t): t is number => t !== null)
        );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Buy tokens up front. Purchases are credited once Stripe confirms the payment.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-ink-800 bg-ink-900 p-6">
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
            Current balance
          </div>
          <div className="mt-2 font-mono text-3xl text-fg">
            {balance === null ? (
              <span className="text-fg-dim">loading</span>
            ) : (
              <>
                {balance.toLocaleString()} <span className="text-xl text-fg-muted">tokens</span>
              </>
            )}
          </div>
        </div>
        {remaining !== null && (
          <div className="font-mono text-xs text-fg-dim">
            ≈ {remaining.toLocaleString()} generations at recent usage
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {packs.map((pack) => {
          const best = pack.id === bestId;
          return (
            <div
              key={pack.id}
              className={`rounded-xl border p-5 ${
                best ? "border-ink-600 bg-ink-850" : "border-ink-800 bg-ink-900"
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="text-sm font-medium text-fg">{packName(pack)}</span>
                {best && (
                  <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                    Best value
                  </span>
                )}
              </div>
              <div className="mt-3 font-mono text-2xl text-fg">{pack.tokens.toLocaleString()}</div>
              <div className="mt-1 font-mono text-xs text-fg-muted">{formatUsd(pack.amountCents)}</div>
              <button
                type="button"
                onClick={() => onBuy(pack.id)}
                disabled={buyingPackId !== null}
                className={`mt-5 w-full rounded-full py-2 text-sm disabled:opacity-60 ${
                  best
                    ? "bg-accent font-medium text-ink-950 hover:bg-accent/90"
                    : "border border-ink-600 text-fg-muted hover:bg-ink-800 hover:text-fg"
                }`}
              >
                {buyingPackId === pack.id ? "Redirecting…" : "Buy"}
              </button>
            </div>
          );
        })}
      </div>

      <div>
        <div className="mb-3 text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
          Purchases
        </div>
        <div className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-800">
                <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
                  Item
                </th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-fg-dim uppercase">
                  Invoice
                </th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const pack = packs.find((x) => x.tokens === p.tokensPurchased);
                return (
                  <tr key={p.id} className="border-b border-ink-850 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-fg-dim">
                      {formatDateTime(p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {p.tokensPurchased.toLocaleString()} tokens
                      {pack ? ` · ${packName(pack)}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-fg">
                      {formatUsd(p.amountCents)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          p.status === "PAID"
                            ? "border-pos/30 bg-pos/10 text-pos"
                            : p.status === "FAILED"
                              ? "border-neg/30 bg-neg/10 text-neg"
                              : "border-ink-600 text-fg-muted"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.invoiceId ? (
                        <a
                          href={apiUrl(`/api/invoices/${p.invoiceId}`)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-fg-dim">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {purchases.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-sm text-fg-dim">
                    {loading ? "Loading…" : "No purchases yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
