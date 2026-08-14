import type { History, LedgerEntry } from "../lib/api";

interface Props {
  ledger: LedgerEntry[];
  history: History | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function HistoryPanel({ ledger, history }: Props) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Ledger</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 font-medium">Type</th>
                <th className="py-1 pr-4 font-medium">Amount</th>
                <th className="py-1 pr-4 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-4 whitespace-nowrap text-neutral-500">{formatDate(entry.createdAt)}</td>
                  <td className="py-1 pr-4">{entry.type}</td>
                  <td className={`py-1 pr-4 ${entry.amount >= 0 ? "text-green-700" : "text-neutral-800"}`}>
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount}
                  </td>
                  <td className="py-1 pr-4">{entry.runningBalance}</td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-neutral-400">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Purchases</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 font-medium">Tokens</th>
                <th className="py-1 pr-4 font-medium">Amount</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {history?.purchases.map((p) => (
                <tr key={p.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-4 whitespace-nowrap text-neutral-500">{formatDate(p.createdAt)}</td>
                  <td className="py-1 pr-4">{p.tokensPurchased.toLocaleString()}</td>
                  <td className="py-1 pr-4">${(p.amountCents / 100).toFixed(2)}</td>
                  <td className="py-1 pr-4">{p.status}</td>
                  <td className="py-1 pr-4">
                    {p.invoiceId ? (
                      <a
                        className="underline"
                        href={`/api/invoices/${p.invoiceId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {(!history || history.purchases.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-3 text-neutral-400">
                    No purchases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Generations</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 font-medium">Prompt</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {history?.generations.map((g) => (
                <tr key={g.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-4 whitespace-nowrap text-neutral-500">{formatDate(g.createdAt)}</td>
                  <td className="max-w-xs truncate py-1 pr-4" title={g.prompt}>
                    {g.prompt}
                  </td>
                  <td className="py-1 pr-4">{g.status}</td>
                  <td className="py-1 pr-4">{g.tokensCharged ?? "—"}</td>
                </tr>
              ))}
              {(!history || history.generations.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-3 text-neutral-400">
                    No generations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Deployments</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">URL</th>
                <th className="py-1 pr-4 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {history?.deployments.map((d) => (
                <tr key={d.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-4 whitespace-nowrap text-neutral-500">{formatDate(d.createdAt)}</td>
                  <td className="py-1 pr-4">{d.status}</td>
                  <td className="py-1 pr-4">
                    {d.liveUrl ? (
                      <a className="underline" href={d.liveUrl} target="_blank" rel="noreferrer">
                        {d.liveUrl}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1 pr-4">{d.tokensCharged ?? "—"}</td>
                </tr>
              ))}
              {(!history || history.deployments.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-3 text-neutral-400">
                    No deployments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
