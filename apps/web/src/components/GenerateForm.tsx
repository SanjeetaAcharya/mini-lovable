import type { FileMap } from "../lib/api";
import { generationErrorMessage } from "../lib/messages";

export type GenerationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "succeeded"; generationId: string; files: FileMap; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; httpStatus: number; error: string; reason?: string };

interface Props {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  state: GenerationState;
}

export function GenerateForm({ prompt, onPromptChange, onSubmit, state }: Props) {
  const loading = state.status === "loading";
  const failure =
    state.status === "failed"
      ? generationErrorMessage(state.httpStatus, state.error, state.reason)
      : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-neutral-800" htmlFor="prompt">
          Describe the site you want
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={3}
          maxLength={2000}
          disabled={loading}
          placeholder="A one-page portfolio site for a photographer, with a hero section and a contact email."
          className="w-full rounded border border-neutral-300 p-3 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-50"
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || prompt.trim().length === 0}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate"}
      </button>

      {loading && (
        <p className="text-sm text-neutral-600">
          Generating your site. This usually takes 30 seconds or more.
        </p>
      )}
      {state.status === "insufficient_balance" && (
        <p className="text-sm text-red-700">
          Not enough tokens. You have {state.balance.toLocaleString()} and this needs at least{" "}
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
      {state.status === "succeeded" && (
        <p className="text-sm text-green-700">
          Generated successfully. Charged {state.tokensCharged.toLocaleString()} tokens.
        </p>
      )}
    </div>
  );
}
