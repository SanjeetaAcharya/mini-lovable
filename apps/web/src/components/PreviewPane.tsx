import type { FileMap } from "../lib/api";
import { buildPreviewDoc } from "../lib/preview";

interface Props {
  files: FileMap | null;
  generating: boolean;
}

export function PreviewPane({ files, generating }: Props) {
  const status = files ? "ready" : generating ? "generating…" : "no build yet";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-widest text-fg-muted uppercase">Preview</span>
        <span className="font-mono text-xs text-fg-muted">{status}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
        {/* Chrome is decorative: it frames the output as a page without
            implying a real browser control surface. */}
        <div className="relative flex shrink-0 items-center gap-1.5 border-b border-ink-800 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-ink-700" />
          <span className="h-2 w-2 rounded-full bg-ink-700" />
          <span className="h-2 w-2 rounded-full bg-ink-700" />
          <span className="pointer-events-none absolute inset-x-0 text-center font-mono text-xs text-fg-muted">
            index.html
          </span>
        </div>

        {files ? (
          <iframe
            title="Generated site preview"
            srcDoc={buildPreviewDoc(files)}
            // No allow-same-origin: this is LLM-generated code running in
            // the browser. Without it the frame gets a unique opaque
            // origin, so its scripts can't read this page, its storage, or
            // make credentialed requests to this app's own API.
            sandbox="allow-scripts"
            className="min-h-0 w-full flex-1 bg-white"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="h-10 w-10 rounded-lg border border-dashed border-ink-500" aria-hidden="true" />
            <p className="max-w-xs text-sm leading-relaxed text-fg-muted">
              Your generated site renders here in a sandboxed frame before it goes anywhere.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
