export type DeployState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; url: string; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; error: string; message?: string };

interface Props {
  state: DeployState;
  onDeploy: () => void;
}

export function DeployPanel({ state, onDeploy }: Props) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onDeploy}
        disabled={state.status === "loading" || state.status === "live"}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {state.status === "loading" ? "Deploying…" : state.status === "live" ? "Deployed" : "Deploy"}
      </button>

      {state.status === "loading" && (
        <p className="text-sm text-neutral-500">Pushing to Vercel — this can take several seconds.</p>
      )}
      {state.status === "live" && (
        <p className="text-sm text-green-700">
          Live at{" "}
          <a className="underline" href={state.url} target="_blank" rel="noreferrer">
            {state.url}
          </a>{" "}
          — charged {state.tokensCharged} tokens.
        </p>
      )}
      {state.status === "insufficient_balance" && (
        <p className="text-sm text-red-600">
          Insufficient balance: you have {state.balance} tokens, deploying needs{" "}
          {state.minimumRequired}. Buy more tokens above to continue.
        </p>
      )}
      {state.status === "failed" && (
        <p className="text-sm text-red-600">
          {state.error}
          {state.message ? `: ${state.message}` : ""}
        </p>
      )}
    </div>
  );
}
