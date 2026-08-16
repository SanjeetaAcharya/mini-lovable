import type { FileMap } from "../lib/api";
import { deploymentErrorMessage, generationErrorMessage } from "../lib/messages";
import type { DeployState, GenerationState } from "../lib/state";
import { ErrorMessage } from "../components/ErrorMessage";
import { PreviewPane } from "../components/PreviewPane";

const MAX_PROMPT_LENGTH = 2000;

interface Props {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  generation: GenerationState;
  deployment: DeployState;
  onDeploy: () => void;
  onTopUp: () => void;
}

export function BuildView({
  prompt,
  onPromptChange,
  onGenerate,
  generation,
  deployment,
  onDeploy,
  onTopUp,
}: Props) {
  const generating = generation.status === "loading";
  const files: FileMap | null = generation.status === "succeeded" ? generation.files : null;

  const generationFailure =
    generation.status === "failed"
      ? generationErrorMessage(generation.httpStatus, generation.error, generation.reason)
      : null;
  const deployFailure =
    deployment.status === "failed"
      ? deploymentErrorMessage(deployment.httpStatus, deployment.error, deployment.message)
      : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">What should we build?</h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            One prompt in, a small static site out. Generation is billed on the tokens the model
            actually used.
          </p>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900 p-3">
          <label htmlFor="prompt" className="sr-only">
            Describe the site you want
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={5}
            maxLength={MAX_PROMPT_LENGTH}
            disabled={generating}
            placeholder="A one-page portfolio site for a photographer, with a hero section and a contact email."
            className="w-full resize-none bg-transparent p-2 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
          />
          <div className="flex items-center justify-between pt-2">
            <span className="font-mono text-xs text-fg-muted">
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </span>
            {/* Generate is the primary action on this screen, so it gets
                the accent fill. Disabled state uses explicit colours
                rather than opacity, which would drag the label below a
                readable contrast ratio. */}
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || prompt.trim().length === 0}
              className={`rounded-full px-5 py-1.5 text-sm font-medium ${
                generating || prompt.trim().length === 0
                  ? "cursor-not-allowed bg-ink-800 text-fg-dim"
                  : "bg-accent text-ink-950 hover:bg-accent/90"
              }`}
            >
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>

        {generating && (
          <p className="text-sm text-fg-muted">
            Generating your site. This usually takes 30 seconds or more.
          </p>
        )}

        {generation.status === "insufficient_balance" && (
          <div className="space-y-2">
            <p className="text-sm text-neg">
              Not enough tokens. You have {generation.balance.toLocaleString()} and this needs at
              least {generation.minimumRequired.toLocaleString()}.
            </p>
            <button type="button" onClick={onTopUp} className="text-sm text-accent hover:underline">
              Top up
            </button>
          </div>
        )}

        {generationFailure && <ErrorMessage error={generationFailure} />}

        {generation.status === "succeeded" && (
          <div className="space-y-4 rounded-xl border border-ink-800 bg-ink-900 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-fg-muted">Generated</span>
              <span className="font-mono text-xs text-fg-muted">
                {generation.tokensCharged.toLocaleString()} tokens
              </span>
            </div>

            {deployment.status !== "live" && (
              <button
                type="button"
                onClick={onDeploy}
                disabled={deployment.status === "loading"}
                className="w-full rounded-full py-2 text-sm font-medium bg-accent text-ink-950 hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-ink-800 disabled:text-fg-dim"
              >
                {deployment.status === "loading" ? "Deploying…" : "Deploy"}
              </button>
            )}

            {deployment.status === "loading" && (
              <p className="text-sm text-fg-muted">Pushing to Vercel. This can take several seconds.</p>
            )}

            {/* The live URL is the payoff of the whole flow, so it gets
                its own block rather than another line of small text. */}
            {deployment.status === "live" && (
              <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
                <div className="text-[10px] font-semibold tracking-widest text-fg-muted uppercase">
                  Live site
                </div>
                <a
                  href={deployment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 block font-mono text-sm break-all text-accent hover:underline"
                >
                  {deployment.url}
                </a>
                <div className="mt-2 font-mono text-xs text-fg-muted">
                  {deployment.tokensCharged.toLocaleString()} tokens
                </div>
              </div>
            )}

            {deployment.status === "insufficient_balance" && (
              <div className="space-y-2">
                <p className="text-sm text-neg">
                  Not enough tokens. You have {deployment.balance.toLocaleString()} and deploying
                  needs {deployment.minimumRequired.toLocaleString()}.
                </p>
                <button type="button" onClick={onTopUp} className="text-sm text-accent hover:underline">
                  Top up
                </button>
              </div>
            )}

            {deployFailure && <ErrorMessage error={deployFailure} />}
          </div>
        )}
      </div>

      <div className="min-h-[600px] lg:h-[calc(100vh-6rem)]">
        <PreviewPane files={files} generating={generating} />
      </div>
    </div>
  );
}
