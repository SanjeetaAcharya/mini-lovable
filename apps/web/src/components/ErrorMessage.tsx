import type { UserFacingError } from "../lib/messages";

/**
 * Plain-language message with the raw server diagnostic tucked behind a
 * collapsed toggle, so a user isn't shown a stack trace but a developer
 * can still get at one.
 */
export function ErrorMessage({ error }: { error: UserFacingError }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-neg">{error.message}</p>
      {error.detail && (
        <details className="text-xs text-fg-dim">
          <summary className="cursor-pointer select-none hover:text-fg-muted">Technical details</summary>
          <p className="mt-1 font-mono break-words text-fg-muted">{error.detail}</p>
        </details>
      )}
    </div>
  );
}
