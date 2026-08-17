const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Bounds worst-case completion length, which in turn bounds what a
// generation can ever cost — see MIN_BALANCE_FOR_GENERATION in
// config/pricing.ts, which is derived from this constant.
//
// This cap is a backstop, not the thing that controls response length —
// the size budget in SYSTEM_PROMPT is. Raising the cap alone never worked:
// at 2000 the model truncated mid-JSON, and at 8000 it simply wrote
// 23,000-28,000 characters and truncated anyway, because nothing bounded
// how much it produced. With the budget in place, measured completions
// against the heaviest prompt run 623-4786 tokens, mean ~2100. 6000 sits
// above that range while keeping the provable worst case — and
// MIN_BALANCE_FOR_GENERATION, which is derived from it — lower than 8000
// did. It is not free of truncation: 1 attempt in 15 still hit this
// ceiling. Raising it trades a higher pre-flight balance gate for that
// last case, which is a pricing decision, not a correctness one.
const MAX_COMPLETION_TOKENS = 6000;

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
  | {
      status: "invalid_output";
      reason: string;
      rawContent: string;
      usage: LlmUsage;
      model: string;
      /** null when the response never got far enough to report one. */
      finishReason: string | null;
    }
  | { status: "error"; message: string };

// How much of a failing model response to put in the logs. Enough to see
// where the JSON goes wrong (the failures cluster a few thousand
// characters in), bounded so one bad generation can't flood the log.
const MAX_LOGGED_CONTENT_CHARS = 4000;

/**
 * One line per generation attempt, on every path including the successful
 * one, as a single JSON object so Render's log search can filter on it.
 * Emitted with console.log/error rather than a logging library because
 * that's all the rest of this app uses, and Render captures stdout as-is.
 */
function logAttempt(fields: Record<string, unknown>, failed: boolean): void {
  const line = JSON.stringify({ event: "llm.generate", ...fields });
  if (failed) {
    console.error(line);
  } else {
    console.log(line);
  }
}

function truncateForLog(text: string): string {
  return text.length > MAX_LOGGED_CONTENT_CHARS
    ? `${text.slice(0, MAX_LOGGED_CONTENT_CHARS)}…[truncated, ${text.length} chars total]`
    : text;
}

const SYSTEM_PROMPT = `You are a code generator that produces small static websites.

Given a user's description, generate the complete file contents for a minimal static site that satisfies it.

Rules:
- Respond with ONLY a single JSON object. No prose, no explanation, no markdown code fences, nothing before or after the JSON.
- The JSON object must have exactly this shape: {"files": {"<relative-path>": "<file-content>", ...}}
- Always include "index.html" as one of the files.
- You may include additional files such as "styles.css" or "script.js" if useful, and reference them from index.html with relative paths.
- Use plain HTML, CSS, and vanilla JavaScript only — no build step, no frameworks, no external dependencies, no CDN links.
- Size budget, and it is hard: at most 3 files, no single file over 2500 characters, no more than 6000 characters across all files combined. Write a concise site that fits the budget rather than a thorough one that runs past it.
- Stay inside the budget by writing less, not by stopping early: no more than 4 page sections, short copy, no filler text.
- Never inline images. No data: URIs, no base64, no inline SVG placeholders — use a plain relative path like "images/hero.jpg" or a CSS background color instead.
- Each file's content is a plain string (properly JSON-escaped), not nested JSON.`;

/**
 * Calls OpenRouter with a prompt and returns either a validated file map
 * with real usage numbers, or a structured failure. Never throws for a
 * malformed model response — only for the request never completing at all,
 * and even that is caught and returned as a result rather than thrown.
 *
 * One attempt only. Callers should go through generateSite, which layers
 * the retry on top.
 */
async function attemptGeneration(
  prompt: string,
  generationId: string | undefined,
  attempt: number
): Promise<LlmResult> {
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    logAttempt({ generationId, attempt, outcome: "misconfigured", reason: "OPENROUTER_MODEL is not set" }, true);
    return { status: "error", message: "OPENROUTER_MODEL is not set" };
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

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
    logAttempt(
      { generationId, attempt, model, durationMs: elapsed(), outcome: "transport_error", error: (err as Error).message },
      true
    );
    return { status: "error", message: `Failed to reach OpenRouter: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logAttempt(
      {
        generationId,
        attempt,
        model,
        durationMs: elapsed(),
        outcome: "http_error",
        httpStatus: response.status,
        // Rate limits and quota exhaustion on :free models arrive here,
        // and the reason is only ever in the body.
        body: truncateForLog(body),
      },
      true
    );
    return {
      status: "error",
      message: `OpenRouter returned ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    };
  }

  // A 200 whose body isn't JSON would otherwise throw straight past this
  // function into the error handler, losing the response entirely.
  let data: any;
  const rawBody = await response.text();
  try {
    data = JSON.parse(rawBody);
  } catch (err) {
    logAttempt(
      {
        generationId,
        attempt,
        model,
        durationMs: elapsed(),
        outcome: "unparseable_envelope",
        httpStatus: response.status,
        body: truncateForLog(rawBody),
      },
      true
    );
    return { status: "error", message: `OpenRouter returned unparseable JSON: ${(err as Error).message}` };
  }

  const usage: LlmUsage = {
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    costUsd: typeof data?.usage?.cost === "number" ? data.usage.cost : null,
  };

  // The single most diagnostic field on the response: "length" means the
  // completion hit MAX_COMPLETION_TOKENS and the JSON is cut off
  // mid-string, which is unrecoverable and looks identical to the model
  // simply emitting bad JSON unless you log this.
  const finishReason = data?.choices?.[0]?.finish_reason ?? null;
  const logBase = {
    generationId,
    attempt,
    model,
    durationMs: elapsed(),
    httpStatus: response.status,
    finishReason,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
  };

  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    logAttempt({ ...logBase, outcome: "empty_content", envelope: truncateForLog(rawBody) }, true);
    return {
      status: "invalid_output",
      reason: "Empty or missing response content",
      rawContent: typeof rawContent === "string" ? rawContent : "",
      usage,
      model,
      finishReason,
    };
  }

  const parsed = parseFileMap(rawContent);
  if (!parsed.ok) {
    logAttempt(
      {
        ...logBase,
        outcome: "invalid_output",
        reason: parsed.reason,
        contentChars: rawContent.length,
        rawContent: truncateForLog(rawContent),
      },
      true
    );
    // finish_reason travels with the reason so the stored/returned failure
    // says whether this was truncation, not just "bad JSON".
    const reason = finishReason === "length" ? `${parsed.reason} (response truncated at max_tokens)` : parsed.reason;
    return { status: "invalid_output", reason, rawContent, usage, model, finishReason };
  }

  logAttempt({ ...logBase, outcome: "success", fileCount: Object.keys(parsed.files).length }, false);
  return { status: "success", files: parsed.files, usage, model };
}

/**
 * Runs a generation, retrying once if the model returns unusable output.
 *
 * The model intermittently emits JSON with invalid escape sequences —
 * inconsistently escaping backslashes, sometimes twice in the same
 * response — which discards an otherwise complete site over one bad
 * character. That's nondeterministic, so the same prompt usually succeeds
 * on a second pass.
 *
 * Deliberately does NOT retry a truncated response: finish_reason
 * "length" means the completion hit MAX_COMPLETION_TOKENS, and re-running
 * an identical request against an identical cap just spends a second call
 * to truncate in the same place. Transport and HTTP errors aren't retried
 * either — those are rate limits and outages, where an immediate retry is
 * the wrong response.
 *
 * The failed attempt's tokens really were spent, but the caller only ever
 * sees the surviving attempt's usage. That follows the existing rule in
 * routes/generate.ts: the user isn't charged for our own failed output.
 */
export async function generateSite(prompt: string, generationId?: string): Promise<LlmResult> {
  const first = await attemptGeneration(prompt, generationId, 1);
  if (first.status !== "invalid_output" || first.finishReason === "length") {
    return first;
  }

  const second = await attemptGeneration(prompt, generationId, 2);
  logAttempt(
    {
      generationId,
      outcome: "retry_complete",
      firstReason: first.reason,
      // Both attempts' tokens were really consumed; only the second is
      // billed, so this line is the only place the absorbed cost appears.
      discardedPromptTokens: first.usage.promptTokens,
      discardedCompletionTokens: first.usage.completionTokens,
      discardedCostUsd: first.usage.costUsd,
      secondStatus: second.status,
    },
    second.status !== "success"
  );
  return second;
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
