import { useState } from "react";
import type { History, LedgerEntry, TokenPack } from "../lib/api";
import { formatDateTime, ledgerLabel, shortenUrl } from "../lib/format";

type Tab = "generations" | "deployments" | "ledger";

const TABS: { id: Tab; label: string }[] = [
  { id: "generations", label: "Generations" },
  { id: "deployments", label: "Deployments" },
  { id: "ledger", label: "Ledger" },
];

interface Props {
  history: History | null;
  ledger: LedgerEntry[];
  packs: TokenPack[];
  loading: boolean;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "SUCCEEDED" || status === "LIVE" || status === "PAID"
      ? "bg-pos"
      : status === "FAILED"
        ? "bg-neg"
        : "bg-accent";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

function EmptyRow({ children }: { children: string }) {
  return <p className="px-4 py-8 text-sm text-fg-muted">{children}</p>;
}

export function HistoryView({ history, ledger, packs, loading }: Props) {
  const [tab, setTab] = useState<Tab>("generations");
  const empty = (message: string) => (loading ? "Loading…" : message);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-2 text-sm text-fg-muted">Every generation and deploy, with the tokens it cost.</p>
      </div>

      <div className="inline-flex gap-1 rounded-full border border-ink-800 bg-ink-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "true" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === t.id ? "bg-ink-750 font-medium text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "generations" && (
        <div className="space-y-2">
          {history?.generations.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-4 py-3"
            >
              <StatusDot status={g.status} />
              <span className="min-w-0 flex-1 truncate text-sm text-fg" title={g.prompt}>
                {g.prompt}
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-muted">
                {g.tokensCharged === null ? (
                  <span className="text-fg-dim">None</span>
                ) : (
                  g.tokensCharged.toLocaleString()
                )}
              </span>
              <span className="w-28 shrink-0 text-right font-mono text-xs text-fg-muted">
                {formatDateTime(g.createdAt)}
              </span>
            </div>
          ))}
          {(!history || history.generations.length === 0) && (
            <EmptyRow>{empty("No generations yet.")}</EmptyRow>
          )}
        </div>
      )}

      {tab === "deployments" && (
        <div className="space-y-2">
          {history?.deployments.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-4 py-3"
            >
              <StatusDot status={d.status} />
              <span className="min-w-0 flex-1 truncate">
                {d.liveUrl ? (
                  <a
                    href={d.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={d.liveUrl}
                    className="font-mono text-sm text-accent hover:underline"
                  >
                    {shortenUrl(d.liveUrl)}
                  </a>
                ) : (
                  <span className="text-sm text-fg-muted">Not deployed</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-muted">
                {d.tokensCharged === null ? (
                  <span className="text-fg-dim">None</span>
                ) : (
                  d.tokensCharged.toLocaleString()
                )}
              </span>
              <span className="w-28 shrink-0 text-right font-mono text-xs text-fg-muted">
                {formatDateTime(d.createdAt)}
              </span>
            </div>
          ))}
          {(!history || history.deployments.length === 0) && (
            <EmptyRow>{empty("No deployments yet.")}</EmptyRow>
          )}
        </div>
      )}

      {tab === "ledger" && (
        <div className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-800">
                <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-fg-muted uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold tracking-widest text-fg-muted uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-fg-muted uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold tracking-widest text-fg-muted uppercase">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id} className="border-b border-ink-850 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-fg-muted">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-fg">
                    {ledgerLabel(entry, history?.purchases ?? [], packs)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      entry.amount >= 0 ? "text-pos" : "text-fg"
                    }`}
                  >
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg">
                    {entry.runningBalance.toLocaleString()}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-sm text-fg-muted">
                    {empty("No activity yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
