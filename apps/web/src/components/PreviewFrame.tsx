import type { FileMap } from "../lib/api";
import { buildPreviewDoc } from "../lib/preview";

interface Props {
  files: FileMap | null;
}

export function PreviewFrame({ files }: Props) {
  if (!files) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Preview</div>
      <iframe
        title="Generated site preview"
        srcDoc={buildPreviewDoc(files)}
        // No allow-same-origin: this is LLM-generated code running in the
        // browser. Without it, the iframe gets a unique opaque origin, so
        // its script can't read the parent page, cookies, or localStorage,
        // or make credentialed requests back to this app's own API.
        sandbox="allow-scripts"
        className="h-[480px] w-full rounded border border-neutral-300 bg-white"
      />
    </div>
  );
}
