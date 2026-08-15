import { useEffect, useState } from "react";
import {
  deploySite,
  generateSite,
  getBalance,
  getHistory,
  getLedger,
  loadInitialData,
  startCheckout,
  type FileMap,
  type History,
  type LedgerEntry,
  type TokenPack,
} from "./lib/api";
import { BalanceBar } from "./components/BalanceBar";
import { GenerateForm, type GenerationState } from "./components/GenerateForm";
import { PreviewFrame } from "./components/PreviewFrame";
import { DeployPanel, type DeployState } from "./components/DeployPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LoadStatus } from "./components/LoadStatus";

type CheckoutNotice = { kind: "success" | "cancelled" } | null;

// "waking" is the cold-start case: the request is in flight but the
// (free-tier) API is likely still spinning up, so we say so out loud.
type LoadState = "loading" | "waking" | "ready" | "failed";

function App() {
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<TokenPack[]>([]);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [generation, setGeneration] = useState<GenerationState>({ status: "idle" });
  const [deployment, setDeployment] = useState<DeployState>({ status: "idle" });

  const [history, setHistory] = useState<History | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Bumping this re-runs the initial load, for the Retry button.
  const [reloadKey, setReloadKey] = useState(0);

  // No router: this app is a single page, so the Stripe return trip is
  // read directly off the URL once, via a lazy initializer, rather than
  // routing to it. Computed here (not in an effect) specifically so it's
  // available before the cleanup/refresh effect below needs to branch on it.
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice>(() => {
    if (window.location.pathname === "/purchase/success") return { kind: "success" };
    if (window.location.pathname === "/purchase/cancelled") return { kind: "cancelled" };
    return null;
  });

  async function refreshBalance() {
    setBalance(await getBalance());
  }

  async function refreshHistory() {
    const [h, l] = await Promise.all([getHistory(), getLedger()]);
    setHistory(h);
    setLedger(l);
  }

  // Initial load, retried through a possible cold start on the API's
  // free-tier host. Re-runs when reloadKey changes (the Retry button).
  useEffect(() => {
    let cancelled = false;

    loadInitialData(() => {
      if (!cancelled) setLoadState("waking");
    })
      .then((data) => {
        if (cancelled) return;
        setBalance(data.balance);
        setPacks(data.packs);
        setHistory(data.history);
        setLedger(data.ledger);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (checkoutNotice === null) return;

    // The notice was already captured into state by the lazy initializer
    // above; now clean the /purchase/success or /purchase/cancelled path
    // Stripe redirected back to.
    window.history.replaceState({}, "", "/");
    if (checkoutNotice.kind !== "success") return;

    // The webhook that actually credits the ledger can land a beat after
    // Stripe redirects the browser back here, so take one more pass a
    // couple seconds later rather than showing a stale balance.
    const timer = setTimeout(() => {
      getBalance().then(setBalance).catch(() => {});
      getHistory().then(setHistory).catch(() => {});
      getLedger().then(setLedger).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // checkoutNotice is derived once from the URL at mount and never
    // changes afterward, so this effect is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBuy(packId: string) {
    setBuyingPackId(packId);
    setCheckoutError(null);
    try {
      const url = await startCheckout(packId);
      window.location.href = url;
    } catch (err) {
      setCheckoutError((err as Error).message);
      setBuyingPackId(null);
    }
  }

  async function handleGenerate() {
    setGeneration({ status: "loading" });
    setDeployment({ status: "idle" });
    const result = await generateSite(prompt);
    if (result.ok) {
      setGeneration({
        status: "succeeded",
        generationId: result.generationId,
        files: result.files,
        tokensCharged: result.tokensCharged,
      });
      setBalance(result.balance);
      refreshHistory().catch(() => {});
    } else if (result.status === 402) {
      setGeneration({
        status: "insufficient_balance",
        balance: result.balance ?? 0,
        minimumRequired: result.minimumRequired ?? 0,
      });
    } else {
      setGeneration({ status: "failed", error: result.error, reason: result.reason });
      refreshHistory().catch(() => {});
    }
  }

  async function handleDeploy() {
    if (generation.status !== "succeeded") return;
    setDeployment({ status: "loading" });
    const result = await deploySite(generation.generationId);
    if (result.ok) {
      setDeployment({ status: "live", url: result.url, tokensCharged: result.tokensCharged });
      refreshBalance().catch(() => {});
      refreshHistory().catch(() => {});
    } else if (result.status === 402) {
      setDeployment({
        status: "insufficient_balance",
        balance: result.balance ?? 0,
        minimumRequired: result.minimumRequired ?? 0,
      });
    } else {
      setDeployment({ status: "failed", error: result.error, message: result.message });
      refreshHistory().catch(() => {});
    }
  }

  const previewFiles: FileMap | null = generation.status === "succeeded" ? generation.files : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-neutral-900">
      <h1 className="mb-6 text-xl font-semibold">mini-lovable</h1>

      <LoadStatus state={loadState} onRetry={() => { setLoadState("loading"); setReloadKey((k) => k + 1); }} />

      {checkoutNotice && (
        <div
          className={`mb-6 flex items-center justify-between rounded border px-3 py-2 text-sm ${
            checkoutNotice.kind === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-neutral-300 bg-neutral-50 text-neutral-700"
          }`}
        >
          <span>
            {checkoutNotice.kind === "success" ? "Payment received — balance updated." : "Checkout cancelled."}
          </span>
          <button type="button" onClick={() => setCheckoutNotice(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {checkoutError && <p className="mb-4 text-sm text-red-600">{checkoutError}</p>}

      <BalanceBar balance={balance} packs={packs} onBuy={handleBuy} buyingPackId={buyingPackId} />

      <div className="my-8">
        <GenerateForm prompt={prompt} onPromptChange={setPrompt} onSubmit={handleGenerate} state={generation} />
      </div>

      {previewFiles && (
        <div className="my-8 space-y-4">
          <PreviewFrame files={previewFiles} />
          <DeployPanel state={deployment} onDeploy={handleDeploy} />
        </div>
      )}

      <div className="mt-12 border-t border-neutral-200 pt-8">
        <HistoryPanel ledger={ledger} history={history} loading={loadState !== "ready" && loadState !== "failed"} />
      </div>
    </div>
  );
}

export default App;
