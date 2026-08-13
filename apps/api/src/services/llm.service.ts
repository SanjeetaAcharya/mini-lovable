const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Bounds worst-case completion length, which in turn bounds what a
// generation can ever cost — see MIN_BALANCE_FOR_GENERATION in
// config/pricing.ts, which is derived from this constant.
const MAX_COMPLETION_TOKENS = 2000;

export interface FileMap {
  [path: string]: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  /** USD cost as reported by OpenRouter, when available. */
  costUsd: number | null;
}

export type LlmResult =
  | { status: "success"; files: FileMap; usage: LlmUsage; model: string }
  | { status: "invalid_output"; reason: string; rawContent: string; usage: LlmUsage; model: string }
  | { status: "error"; message: string };

const SYSTEM_PROMPT = `You are a code generator that produces small static websites.

Given a user's description, generate the complete file contents for a minimal static site that satisfies it.

Rules:
- Respond with ONLY a single JSON object. No prose, no explanation, no markdown code fences, nothing before or after the JSON.
- The JSON object must have exactly this shape: {"files": {"<relative-path>": "<file-content>", ...}}
- Always include "index.html" as one of the files.
- You may include additional files such as "styles.css" or "script.js" if useful, and reference them from index.html with relative paths.
- Use plain HTML, CSS, and vanilla JavaScript only — no build step, no frameworks, no external dependencies, no CDN links.
- Keep the site small: at most 5 files total.
- Each file's content is a plain string (properly JSON-escaped), not nested JSON.`;

/**
 * Calls OpenRouter with a prompt and returns either a validated file map
 * with real usage numbers, or a structured failure. Never throws for a
 * malformed model response — only for the request never completing at all,
 * and even that is caught and returned as a result rather than thrown.
 */
export async function generateSite(prompt: string): Promise<LlmResult> {
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    return { status: "error", message: "OPENROUTER_MODEL is not set" };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        usage: { include: true },
        max_tokens: MAX_COMPLETION_TOKENS,
      }),
    });
  } catch (err) {
    return { status: "error", message: `Failed to reach OpenRouter: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      status: "error",
      message: `OpenRouter returned ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    };
  }

  const data = await response.json();

  const usage: LlmUsage = {
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    costUsd: typeof data?.usage?.cost === "number" ? data.usage.cost : null,
  };

  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    return {
      status: "invalid_output",
      reason: "Empty or missing response content",
      rawContent: typeof rawContent === "string" ? rawContent : "",
      usage,
      model,
    };
  }

  const parsed = parseFileMap(rawContent);
  if (!parsed.ok) {
    return { status: "invalid_output", reason: parsed.reason, rawContent, usage, model };
  }

  return { status: "success", files: parsed.files, usage, model };
}

function parseFileMap(rawContent: string): { ok: true; files: FileMap } | { ok: false; reason: string } {
  const jsonText = extractJson(rawContent);
  if (jsonText === null) {
    return { ok: false, reason: "No JSON object found in model output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, reason: `JSON parse error: ${(err as Error).message}` };
  }

  return validateFileMap(parsed);
}

/**
 * Model output is supposed to be bare JSON, but strips markdown fences
 * first anyway in case the model ignores that instruction, then narrows
 * to the outermost {...} block.
 */
function extractJson(text: string): string | null {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return cleaned.slice(start, end + 1);
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 200_000;
// Relative paths only — no leading slash, no traversal.
const FILE_PATH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

function validateFileMap(value: unknown): { ok: true; files: FileMap } | { ok: false; reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Top-level output is not a JSON object" };
  }

  const candidate = (value as Record<string, unknown>).files;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: "'files' is missing or not an object" };
  }

  const entries = Object.entries(candidate as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, reason: "No files returned" };
  }
  if (entries.length > MAX_FILES) {
    return { ok: false, reason: `Too many files: ${entries.length} (max ${MAX_FILES})` };
  }

  const files: FileMap = {};
  for (const [path, content] of entries) {
    if (!FILE_PATH_PATTERN.test(path) || path.includes("..")) {
      return { ok: false, reason: `Unsafe or invalid file path: ${path}` };
    }
    if (typeof content !== "string") {
      return { ok: false, reason: `Content for ${path} is not a string` };
    }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      return { ok: false, reason: `File ${path} exceeds max size` };
    }
    files[path] = content;
  }

  if (!("index.html" in files)) {
    return { ok: false, reason: "Missing required index.html" };
  }

  return { ok: true, files };
}
