import type { FileMap } from "./api";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generated sites are multiple files (index.html + styles.css + maybe a
 * script or an inline-able svg), but an iframe's srcDoc has no real base
 * URL to resolve relative hrefs/srcs against. Rather than standing up a
 * static file server just for the preview, this inlines every referenced
 * file directly into the HTML: <link rel="stylesheet"> becomes <style>,
 * <script src> becomes an inline <script>, and .svg references become
 * data URIs. This is a regex-based text transform, not an HTML parser —
 * fine for a preview convenience, not something to trust as a security
 * boundary (the iframe sandbox below is what does that).
 */
export function buildPreviewDoc(files: FileMap): string {
  let html = files["index.html"] ?? "";

  for (const [path, content] of Object.entries(files)) {
    if (path === "index.html") continue;
    const escapedPath = escapeRegExp(path);

    if (/\.css$/i.test(path)) {
      const linkRe = new RegExp(`<link[^>]+href=["']${escapedPath}["'][^>]*>`, "i");
      html = html.replace(linkRe, `<style>${content}</style>`);
    } else if (/\.js$/i.test(path)) {
      const scriptRe = new RegExp(`<script[^>]+src=["']${escapedPath}["'][^>]*></script>`, "i");
      // Escape any literal "</script" inside the generated JS so it can't
      // prematurely close the tag we're inlining it into.
      const safeContent = content.replace(/<\/script/gi, "<\\/script");
      html = html.replace(scriptRe, `<script>${safeContent}</script>`);
    } else if (/\.svg$/i.test(path)) {
      const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(content)))}`;
      html = html.split(`"${path}"`).join(`"${dataUri}"`).split(`'${path}'`).join(`'${dataUri}'`);
    }
    // Raster image extensions (png/jpg/gif/webp/ico) aren't inlined: the
    // model can only emit text, so any raster "content" it wrote wouldn't
    // be valid image bytes anyway. Left as a broken reference rather than
    // faked.
  }

  return html;
}
