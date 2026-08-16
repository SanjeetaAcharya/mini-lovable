interface Props {
  state: "loading" | "waking" | "ready" | "failed";
  onRetry: () => void;
}

/**
 * Covers the first few seconds of a cold start. The API is on a free tier
 * that sleeps after inactivity, so the alternative to this is a page of
 * empty tables and a blank balance, which reads as a broken app rather
 * than a waking one.
 */
export function LoadStatus({ state, onRetry }: Props) {
  if (state === "ready") return null;

  if (state === "failed") {
    return (
      <div className="mb-6 flex items-center justify-between rounded-lg border border-neg/30 bg-neg/10 px-4 py-2.5 text-sm text-neg">
        <span>Couldn't reach the server. It may still be starting up.</span>
        <button type="button" onClick={onRetry} className="ml-3 text-xs underline opacity-80 hover:opacity-100">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm text-fg-muted">
      {state === "waking" ? (
        <>
          <span className="font-medium text-fg">Waking up the server…</span> The API is hosted on a
          free tier that sleeps when idle, so the first request after a while can take up to a
          minute. This page will fill in automatically.
        </>
      ) : (
        "Loading…"
      )}
    </div>
  );
}
