import type { View } from "../lib/state";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  balance: number | null;
}

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "build", label: "Build", icon: "✦" },
  { id: "history", label: "History", icon: "≡" },
  { id: "billing", label: "Billing", icon: "◉" },
];

// The meter is indicative, not a quota: it shows the balance against one
// Pro pack (the largest purchasable amount), capped at full.
const METER_REFERENCE_TOKENS = 30_000;

export function Sidebar({ view, onNavigate, balance }: Props) {
  const meterPercent =
    balance === null ? 0 : Math.min(100, Math.round((balance / METER_REFERENCE_TOKENS) * 100));

  return (
    <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="h-4 w-4 rounded-full bg-accent" aria-hidden="true" />
        <span className="text-sm font-semibold tracking-tight">mini-lovable</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${
                active
                  ? "bg-ink-750 font-medium text-fg"
                  : "text-fg-muted hover:bg-ink-850 hover:text-fg"
              }`}
            >
              <span className={`w-3 text-xs ${active ? "text-accent" : "text-fg-dim"}`} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
          <div className="text-[10px] font-semibold tracking-widest text-fg-muted uppercase">Balance</div>
          <div className="mt-1.5 font-mono text-lg text-fg">
            {balance === null ? (
              <span className="text-fg-muted">loading</span>
            ) : (
              <>
                {balance.toLocaleString()} <span className="text-sm text-fg-muted">tokens</span>
              </>
            )}
          </div>
          <div className="mt-2.5 h-px w-full bg-ink-700">
            <div className="h-px bg-accent" style={{ width: `${meterPercent}%` }} />
          </div>
          <button
            type="button"
            onClick={() => onNavigate("billing")}
            className="mt-3 w-full rounded-full border border-ink-500 py-1.5 text-xs text-fg hover:bg-ink-800"
          >
            Top up
          </button>
        </div>
      </div>
    </aside>
  );
}
