import type { FileMap } from "./llm.service";

const VERCEL_DEPLOYMENTS_URL = "https://api.vercel.com/v13/deployments";

// Static file deployments with no build step are typically ready in
// seconds, but this still polls rather than trusting the initial POST
// response, since Vercel can return before the deployment has actually
// finished processing.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

export type DeploymentResult = { status: "success"; url: string } | { status: "error"; message: string };

/**
 * Pushes a FileMap to Vercel as a new production deployment and polls
 * until it's ready, errored, or the poll times out. Never throws — a
 * network failure, a bad token, or Vercel rejecting the files all come
 * back as a structured `{status: "error"}` so the caller can mark the
 * Deployment row FAILED and skip the ledger debit, same as a failed LLM
 * call never gets billed.
 *
 * Vercel auto-creates a project named `projectName` on first deploy and
 * reuses it on any later deploy that passes the same name — no dashboard
 * setup required, matching how Stripe checkout prices are created
 * inline rather than pre-configured.
 */
export async function deployToVercel(files: FileMap, projectName: string): Promise<DeploymentResult> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    return { status: "error", message: "VERCEL_API_TOKEN is not set" };
  }

  let response: Response;
  try {
    response = await fetch(VERCEL_DEPLOYMENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        target: "production",
        // No framework, no build command — these are already-generated
        // static files, served as-is.
        projectSettings: { framework: null },
        files: Object.entries(files).map(([file, content]) => ({
          file,
          data: Buffer.from(content, "utf8").toString("base64"),
          encoding: "base64",
        })),
      }),
    });
  } catch (err) {
    return { status: "error", message: `Failed to reach Vercel: ${(err as Error).message}` };
  }

  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `Vercel returned ${response.status} ${response.statusText}`;
    return { status: "error", message };
  }

  const deploymentId: string | undefined = body?.id;
  const rawUrl: string | undefined = body?.url;
  if (!deploymentId || !rawUrl) {
    return { status: "error", message: "Vercel response was missing a deployment id or url" };
  }

  // New Vercel projects default to gating *every* deployment — including
  // production — behind Vercel's own SSO wall ("Deployment Protection").
  // Left alone, the URL we return would redirect to a Vercel login page
  // instead of the site, defeating the point of a link meant to open
  // directly in a browser. The project now exists (created implicitly by
  // the POST above), so turn that off. Best-effort: if it fails, the
  // deploy is still genuinely live, just possibly still gated — not worth
  // failing an otherwise-successful deploy over.
  await disableDeploymentProtection(projectName, token);

  return pollUntilReady(deploymentId, token, `https://${rawUrl}`);
}

async function disableDeploymentProtection(projectName: string, token: string): Promise<void> {
  try {
    await fetch(`https://api.vercel.com/v9/projects/${projectName}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });
  } catch {
    // Best-effort, see comment at the call site.
  }
}

async function pollUntilReady(deploymentId: string, token: string, liveUrl: string): Promise<DeploymentResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      return { status: "error", message: `Failed to poll Vercel deployment status: ${(err as Error).message}` };
    }

    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.error?.message ?? `Vercel returned ${response.status} while polling deployment status`;
      return { status: "error", message };
    }

    const state: string | undefined = body?.readyState;
    if (state === "READY") {
      return { status: "success", url: liveUrl };
    }
    if (state === "ERROR" || state === "CANCELED") {
      return { status: "error", message: `Vercel deployment ended in state ${state}` };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: "error", message: `Vercel deployment did not become ready within ${POLL_TIMEOUT_MS}ms` };
}
