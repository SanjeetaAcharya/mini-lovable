import { deploymentErrorMessage } from "../lib/messages";

export type DeployState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; url: string; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; httpStatus: number; error: string; message?: string };

interface Props {
  state: DeployState;
  onDeploy: () => void;
}

export function DeployPanel({ state, onDeploy }: Props) {
  const failure =
    state.status === "failed"
      ? deploymentErrorMessage(state.httpStatus, state.error, state.message)
      : null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onDeploy}
        disabled={state.status === "loading" || state.status === "live"}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {state.status === "loading" ? "Deploying…" : state.status === "live" ? "Deployed" : "Deploy"}
      </button>

      {state.status === "loading" && (
        <p className="text-sm text-neutral-600">Pushing to Vercel. This can take several seconds.</p>
      )}

      {/* The live URL is the payoff of the whole flow, so it gets its own
          panel rather than being one more line of small grey text. */}
      {state.status === "live" && (
        <div className="rounded border border-green-300 bg-green-50 p-4">
          <div className="text-xs font-semibold tracking-wide text-green-800 uppercase">Live site</div>
          <a
            className="mt-1 block font-medium break-all text-green-900 underline"
            href={state.url}
            target="_blank"
            rel="noreferrer"
          >
            {state.url}
          </a>
          <div className="mt-2 text-xs text-green-800">
            Charged {state.tokensCharged.toLocaleString()} tokens.
          </div>
        </div>
      )}

      {state.status === "insufficient_balance" && (
        <p className="text-sm text-red-700">
          Not enough tokens. You have {state.balance.toLocaleString()} and deploying needs{" "}
          {state.minimumRequired.toLocaleString()}. Buy more tokens above to continue.
        </p>
      )}
      {failure && (
        <div className="space-y-1.5">
          <p className="text-sm text-red-700">{failure.message}</p>
          {failure.detail && (
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <p className="mt-1 font-mono break-words text-neutral-600">{failure.detail}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
