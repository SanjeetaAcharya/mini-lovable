import { apiUrl, type History, type LedgerEntry } from "../lib/api";

interface Props {
  ledger: LedgerEntry[];
  history: History | null;
  /** True until the initial load finishes, including through a cold start. */
  loading?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Subtle colouring only — enough that a status column scans at a glance
// without turning the table into a traffic light.
function statusClass(status: string): string {
  switch (status) {
    case "PAID":
    case "SUCCEEDED":
    case "LIVE":
      return "text-green-700";
    case "FAILED":
      return "text-red-700";
    case "PENDING":
      return "text-amber-700";
    default:
      return "text-neutral-700";
  }
}

const TH = "px-3 py-2 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase";
const TD = "px-3 py-2.5 align-top";

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-3 text-base font-semibold text-neutral-900">{children}</h2>;
}

export function HistoryPanel({ ledger, history, loading = false }: Props) {
  // While the initial load is still in flight, "No activity yet." would be
  // a claim we haven't verified — and on a cold start it's the difference
  // between the page looking empty and the page looking broken.
  const empty = (message: string) => (loading ? "Loading…" : message);

  return (
    <div className="space-y-12">
      <section>
        <SectionHeading>Ledger</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-neutral-200 text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className={TH}>Date</th>
                <th className={TH}>Type</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-100">
                  <td className={`${TD} whitespace-nowrap text-neutral-500`}>{formatDate(entry.createdAt)}</td>
                  <td className={`${TD} text-neutral-700`}>{entry.type}</td>
                  <td
                    className={`${TD} tabular-nums ${entry.amount >= 0 ? "text-green-700" : "text-neutral-900"}`}
                  >
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount.toLocaleString()}
                  </td>
                  <td className={`${TD} tabular-nums text-neutral-900`}>
                    {entry.runningBalance.toLocaleString()}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={4} className={`${TD} text-neutral-400`}>
                    {empty("No activity yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading>Purchases</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-neutral-200 text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className={TH}>Date</th>
                <th className={TH}>Tokens</th>
                <th className={TH}>Amount</th>
                <th className={TH}>Status</th>
                <th className={TH}>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {history?.purchases.map((p) => (
                <tr key={p.id} className="border-b border-neutral-100">
                  <td className={`${TD} whitespace-nowrap text-neutral-500`}>{formatDate(p.createdAt)}</td>
                  <td className={`${TD} tabular-nums text-neutral-900`}>{p.tokensPurchased.toLocaleString()}</td>
                  <td className={`${TD} tabular-nums text-neutral-900`}>${(p.amountCents / 100).toFixed(2)}</td>
                  <td className={`${TD} font-medium ${statusClass(p.status)}`}>{p.status}</td>
                  <td className={TD}>
                    {p.invoiceId ? (
                      <a
                        className="text-neutral-700 underline"
                        href={apiUrl(`/api/invoices/${p.invoiceId}`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-neutral-400">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {(!history || history.purchases.length === 0) && (
                <tr>
                  <td colSpan={5} className={`${TD} text-neutral-400`}>
                    {empty("No purchases yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading>Generations</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-neutral-200 text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className={TH}>Date</th>
                <th className={TH}>Prompt</th>
                <th className={TH}>Status</th>
                <th className={TH}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {history?.generations.map((g) => (
                <tr key={g.id} className="border-b border-neutral-100">
                  <td className={`${TD} whitespace-nowrap text-neutral-500`}>{formatDate(g.createdAt)}</td>
                  <td className={`${TD} max-w-xs truncate text-neutral-700`} title={g.prompt}>
                    {g.prompt}
                  </td>
                  <td className={`${TD} font-medium ${statusClass(g.status)}`}>{g.status}</td>
                  <td className={`${TD} tabular-nums text-neutral-900`}>
                    {g.tokensCharged === null ? (
                      <span className="text-neutral-400">None</span>
                    ) : (
                      g.tokensCharged.toLocaleString()
                    )}
                  </td>
                </tr>
              ))}
              {(!history || history.generations.length === 0) && (
                <tr>
                  <td colSpan={4} className={`${TD} text-neutral-400`}>
                    {empty("No generations yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading>Deployments</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-neutral-200 text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className={TH}>Date</th>
                <th className={TH}>Status</th>
                <th className={TH}>URL</th>
                <th className={TH}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {history?.deployments.map((d) => (
                <tr key={d.id} className="border-b border-neutral-100">
                  <td className={`${TD} whitespace-nowrap text-neutral-500`}>{formatDate(d.createdAt)}</td>
                  <td className={`${TD} font-medium ${statusClass(d.status)}`}>{d.status}</td>
                  <td className={TD}>
                    {d.liveUrl ? (
                      <a
                        className="break-all text-neutral-700 underline"
                        href={d.liveUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.liveUrl}
                      </a>
                    ) : (
                      <span className="text-neutral-400">None</span>
                    )}
                  </td>
                  <td className={`${TD} tabular-nums text-neutral-900`}>
                    {d.tokensCharged === null ? (
                      <span className="text-neutral-400">None</span>
                    ) : (
                      d.tokensCharged.toLocaleString()
                    )}
                  </td>
                </tr>
              ))}
              {(!history || history.deployments.length === 0) && (
                <tr>
                  <td colSpan={4} className={`${TD} text-neutral-400`}>
                    {empty("No deployments yet.")}
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
