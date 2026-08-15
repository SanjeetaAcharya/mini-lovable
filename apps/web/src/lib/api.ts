// Unset in local dev: requests to "/api/..." stay relative, and the Vite
// dev server proxies them to localhost:4000 (see vite.config.ts). Set to
// the deployed API's origin in production, baked in at build time.
const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API_ORIGIN}/api`;

/**
 * For links meant to be opened directly (e.g. an invoice's <a href>),
 * not fetched — same origin logic as BASE, exported since components
 * outside this module need it too.
 */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

export interface TokenPack {
  id: string;
  label: string;
  amountCents: number;
  tokens: number;
}

export interface FileMap {
  [path: string]: string;
}

export type GenerateResult =
  | { ok: true; generationId: string; files: FileMap; tokensCharged: number; balance: number }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: string;
      balance?: number;
      minimumRequired?: number;
    };

export type DeployResult =
  | { ok: true; deploymentId: string; url: string; tokensCharged: number }
  | {
      ok: false;
      status: number;
      error: string;
      message?: string;
      balance?: number;
      minimumRequired?: number;
    };

export interface HistoryPurchase {
  id: string;
  amountCents: number;
  tokensPurchased: number;
  status: string;
  createdAt: string;
  invoiceId: string | null;
}

export interface HistoryGeneration {
  id: string;
  prompt: string;
  status: string;
  tokensCharged: number | null;
  createdAt: string;
}

export interface HistoryDeployment {
  id: string;
  generationId: string;
  status: string;
  liveUrl: string | null;
  tokensCharged: number | null;
  createdAt: string;
}

export interface History {
  purchases: HistoryPurchase[];
  generations: HistoryGeneration[];
  deployments: HistoryDeployment[];
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  runningBalance: number;
  createdAt: string;
  purchaseId: string | null;
  generationId: string | null;
  deploymentId: string | null;
}

/**
 * GET a JSON endpoint, throwing on a non-OK status instead of returning
 * a half-parsed body. Matters for the cold-start path: a sleeping Render
 * instance answers with a 502/503 HTML page, and without this check the
 * caller would quietly end up with `undefined` and render an empty UI
 * that looks like real (but empty) data rather than a failure to load.
 */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function getBalance(): Promise<number> {
  const data = await getJson<{ balance: number }>("/balance");
  return data.balance;
}

export async function getPacks(): Promise<TokenPack[]> {
  const data = await getJson<{ packs: TokenPack[] }>("/checkout/packs");
  return data.packs;
}

export async function startCheckout(packId: string): Promise<string> {
  const res = await fetch(`${BASE}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");
  return data.url;
}

export async function generateSite(prompt: string): Promise<GenerateResult> {
  try {
    const res = await fetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error ?? "Generation failed",
        reason: data.reason,
        balance: data.balance,
        minimumRequired: data.minimumRequired,
      };
    }
    return {
      ok: true,
      generationId: data.generationId,
      files: data.files,
      tokensCharged: data.tokensCharged,
      balance: data.balance,
    };
  } catch (err) {
    return { ok: false, status: 0, error: `Failed to reach the server: ${(err as Error).message}` };
  }
}

export async function deploySite(generationId: string): Promise<DeployResult> {
  try {
    const res = await fetch(`${BASE}/deploy/${generationId}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error ?? "Deployment failed",
        message: data.message,
        balance: data.balance,
        minimumRequired: data.minimumRequired,
      };
    }
    return { ok: true, deploymentId: data.deploymentId, url: data.url, tokensCharged: data.tokensCharged };
  } catch (err) {
    return { ok: false, status: 0, error: `Failed to reach the server: ${(err as Error).message}` };
  }
}

export async function getHistory(): Promise<History> {
  return getJson<History>("/history");
}

export async function getLedger(): Promise<LedgerEntry[]> {
  const data = await getJson<{ entries: LedgerEntry[] }>("/ledger");
  return data.entries;
}

export interface InitialData {
  balance: number;
  packs: TokenPack[];
  history: History;
  ledger: LedgerEntry[];
}

// The API is hosted on Render's free tier, which spins the instance down
// after ~15 minutes of inactivity. The first request after that wakes it,
// which can take 30-60s and may fail outright before it's ready. Since a
// reviewer opening a cold link is the single most likely first
// impression, retry rather than rendering an empty page that reads as
// broken.
const BOOTSTRAP_ATTEMPTS = 24;
const BOOTSTRAP_RETRY_MS = 3000;
// How long to wait before admitting to the user that we're waiting on a
// sleeping server. A warm API answers in well under this, so the notice
// never flashes up in the normal case.
const COLD_START_NOTICE_MS = 2500;

/**
 * Loads everything the page needs, retrying through a cold start.
 * `onSlow` fires once if the first attempt hasn't come back quickly, so
 * the caller can show a "waking up the server" state instead of leaving
 * the reviewer looking at blank tables.
 */
export async function loadInitialData(onSlow: () => void): Promise<InitialData> {
  const noticeTimer = setTimeout(onSlow, COLD_START_NOTICE_MS);

  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt++) {
      try {
        const [balance, packs, history, ledger] = await Promise.all([
          getBalance(),
          getPacks(),
          getHistory(),
          getLedger(),
        ]);
        return { balance, packs, history, ledger };
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_MS));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not reach the API");
  } finally {
    clearTimeout(noticeTimer);
  }
}
