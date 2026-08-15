interface Props {
  state: "loading" | "waking" | "ready" | "failed";
  onRetry: () => void;
}

/**
 * Covers the first few seconds of a cold start. The API is on a free tier
 * that sleeps after inactivity, so the alternative to this is a page of
 * empty tables and a "—" balance, which reads as a broken app rather than
 * a waking one.
 */
export function LoadStatus({ state, onRetry }: Props) {
  if (state === "ready") return null;

  if (state === "failed") {
    return (
      <div className="mb-6 flex items-center justify-between rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        <span>Couldn't reach the server. It may still be starting up.</span>
        <button type="button" onClick={onRetry} className="ml-3 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
      {state === "waking" ? (
        <>
          <span className="font-medium">Waking up the server…</span> The API is hosted on a free tier
          that sleeps when idle, so the first request after a while can take up to a minute. This
          page will fill in automatically.
        </>
      ) : (
        "Loading…"
      )}
    </div>
  );
}
