import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileMap } from "./llm.service";

export type SandboxResult =
  | { valid: true; artifactPath: string }
  | { valid: false; reason: string };

// Built ahead of time via:
//   docker build -f docker/sandbox.Dockerfile -t mini-lovable-sandbox docker/
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "mini-lovable-sandbox";

/**
 * Off unless explicitly switched on, because validation needs a Docker
 * daemon and the deployed API doesn't have one: Render runs the app
 * *inside* a container with no daemon socket, so every deploy would fail
 * on infrastructure grounds rather than on anything about the generated
 * site. Enable it where a daemon exists (local development, or a host
 * that grants one) by setting SANDBOX_ENABLED=true.
 */
export function isSandboxEnabled(): boolean {
  return process.env.SANDBOX_ENABLED === "true";
}

// Generous for a static-file check that does no build step, tight enough
// that a hung or adversarial container can't tie up resources.
const SANDBOX_TIMEOUT_MS = 15_000;
const SANDBOX_MEMORY = "128m";
const SANDBOX_CPUS = "0.5";
const SANDBOX_PIDS_LIMIT = "64";

/**
 * Writes a validated FileMap to a throwaway temp directory, then runs it
 * through a locked-down, disposable Docker container to confirm the output
 * is servable static content and that index.html structurally parses.
 * Never runs a build step and never executes any of the generated files —
 * see docker/sandbox.Dockerfile for exactly what isolation this provides
 * and, just as importantly, what it does not provide compared to a
 * purpose-built sandbox like E2B.
 *
 * Returns a structured result rather than throwing: `valid: true` with the
 * host path the (still-present) files live at, or `valid: false` with a
 * human-readable reason — whether that reason is "the site is broken" or
 * "Docker itself isn't available" is not distinguished here, because
 * either way the caller's answer is the same: don't deploy this.
 */
export async function validateInSandbox(files: FileMap): Promise<SandboxResult> {
  let artifactDir: string;
  try {
    artifactDir = await writeFileMapToTempDir(files);
  } catch (err) {
    return { valid: false, reason: `failed to stage files for sandbox: ${(err as Error).message}` };
  }

  const outcome = await runSandboxContainer(artifactDir);

  if (!outcome.parsed || !outcome.parsed.valid) {
    // Not the returned artifact — clean up rather than leaking temp dirs
    // on every rejected generation.
    await rm(artifactDir, { recursive: true, force: true });
    const reason = outcome.parsed ? outcome.parsed.reason ?? "sandbox rejected output" : outcome.failureReason;
    return { valid: false, reason };
  }

  return { valid: true, artifactPath: artifactDir };
}

/**
 * Writes each file in the map under a fresh temp directory, preserving any
 * subdirectories in the path (e.g. "css/style.css").
 */
async function writeFileMapToTempDir(files: FileMap): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mini-lovable-sandbox-"));

  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(dir, relPath);
      // llm.service.ts already rejects traversal in the path itself, but
      // this is the last point before anything touches disk, so it
      // re-checks rather than trusting the caller.
      if (path.relative(dir, target).startsWith("..")) {
        throw new Error(`refusing to write outside sandbox dir: ${relPath}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  return dir;
}

interface ContainerOutcome {
  parsed: { valid: boolean; reason?: string } | null;
  /** Only meaningful when parsed is null. */
  failureReason: string;
}

/**
 * Runs one throwaway container against `hostDir`, mounted read-only, with
 * no network access, hard resource limits, and a hard wall-clock timeout.
 * The container is always removed in the `finally` block — on success, on
 * a validation failure, on a Docker-level error, and on timeout alike —
 * so a run can never leave a container behind.
 */
async function runSandboxContainer(hostDir: string): Promise<ContainerOutcome> {
  const containerName = `mini-lovable-sandbox-${randomUUID()}`;

  const args = [
    "run",
    "--name",
    containerName,
    "--network",
    "none",
    "--memory",
    SANDBOX_MEMORY,
    "--memory-swap",
    SANDBOX_MEMORY, // no swap headroom beyond the memory limit itself
    "--cpus",
    SANDBOX_CPUS,
    "--pids-limit",
    SANDBOX_PIDS_LIMIT,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-v",
    `${hostDir}:/workspace:ro`,
    SANDBOX_IMAGE,
  ];

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  try {
    let exitCode: number | null;
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn("docker", args);

        const timer = setTimeout(() => {
          timedOut = true;
          // Best-effort: the `docker rm -f` in the outer `finally` is what
          // actually guarantees the container is gone, this just ends the
          // run promptly instead of waiting out the process's own logic.
          spawn("docker", ["kill", containerName]);
        }, SANDBOX_TIMEOUT_MS);

        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
    } catch (err) {
      // e.g. `docker` not on PATH, or the daemon isn't running.
      return { parsed: null, failureReason: `failed to run sandbox container: ${(err as Error).message}` };
    }

    if (timedOut) {
      return { parsed: null, failureReason: `sandbox validation timed out after ${SANDBOX_TIMEOUT_MS}ms` };
    }

    // The container's own exit code isn't fully trustworthy on its own —
    // a nonzero exit can mean "validation failed" (expected, exit 1) or
    // "Docker had trouble starting the container" (unexpected). The JSON
    // line on stdout is the real source of truth either way, so parse it
    // first and only fall back to a raw-output error if that fails.
    const lastLine = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    try {
      const result = JSON.parse(lastLine) as { valid: boolean; reason?: string };
      return { parsed: result, failureReason: "" };
    } catch {
      return {
        parsed: null,
        failureReason: `sandbox produced no readable result (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}`,
      };
    }
  } finally {
    await new Promise<void>((resolve) => {
      const cleanup = spawn("docker", ["rm", "-f", containerName]);
      cleanup.on("close", () => resolve());
      cleanup.on("error", () => resolve());
    });
  }
}
