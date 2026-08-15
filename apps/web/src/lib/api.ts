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

export async function getBalance(): Promise<number> {
  const res = await fetch(`${BASE}/balance`);
  const data = await res.json();
  return data.balance;
}

export async function getPacks(): Promise<TokenPack[]> {
  const res = await fetch(`${BASE}/checkout/packs`);
  const data = await res.json();
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
  const res = await fetch(`${BASE}/history`);
  return res.json();
}

export async function getLedger(): Promise<LedgerEntry[]> {
  const res = await fetch(`${BASE}/ledger`);
  const data = await res.json();
  return data.entries;
}
