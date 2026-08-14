import type { FileMap } from "../lib/api";

export type GenerationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "succeeded"; generationId: string; files: FileMap; tokensCharged: number }
  | { status: "insufficient_balance"; balance: number; minimumRequired: number }
  | { status: "failed"; error: string; reason?: string };

interface Props {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  state: GenerationState;
}

export function GenerateForm({ prompt, onPromptChange, onSubmit, state }: Props) {
  const loading = state.status === "loading";

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-700" htmlFor="prompt">
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
        className="w-full rounded border border-neutral-300 p-3 text-sm disabled:bg-neutral-50"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || prompt.trim().length === 0}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate"}
      </button>

      {loading && (
        <p className="text-sm text-neutral-500">
          Generating your site — this usually takes 30 seconds or more.
        </p>
      )}
      {state.status === "insufficient_balance" && (
        <p className="text-sm text-red-600">
          Insufficient balance: you have {state.balance} tokens, this needs at least{" "}
          {state.minimumRequired}. Buy more tokens above to continue.
        </p>
      )}
      {state.status === "failed" && (
        <p className="text-sm text-red-600">
          {state.error}
          {state.reason ? `: ${state.reason}` : ""}
        </p>
      )}
      {state.status === "succeeded" && (
        <p className="text-sm text-green-700">
          Generated successfully — charged {state.tokensCharged} tokens.
        </p>
      )}
    </div>
  );
}
