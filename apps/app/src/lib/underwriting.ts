import { type Address, getAddress, type Hex, isAddress, stringToHex } from "viem";
import { authorize } from "./account";
import { ApiError, api, apiConfigured } from "./api";
import { mockLedger } from "./data/mock";
import { notifyDataChanged } from "./data/changes";

/**
 * Getting a Pay in 4 line (plan §5.5), through the CRE underwriting workflow.
 *
 * The buyer's account signs its consent to be underwritten (Face ID, no
 * prompt beyond it); to "Bring your history", the wallet they already use
 * also signs that its history counts toward this account (their wallet's
 * own prompt). Polaris for Business checks both, queues the workflow's
 * HTTP trigger, and the DON checks them again before it reads Nansen and
 * the chain and writes the facts to ScoreManager. The texts come from the
 * API (`/api/public/credit/{account}/messages`), which serves exactly what
 * the workflow verifies.
 *
 * Without the API (the offline demo) this is the sample ledger's stand-in,
 * and says so: nothing is underwritten.
 */

type Messages = { account: Address; wallet: Address | null; issuedAt: number; nonce: string; consent: string; link: string | null };

export type CreditDecision = {
  status: "applied" | "refused" | "thin";
  score: number | null;
  reason: string | null;
  explanation: { reasons: Array<{ text: string; points: number | null; provider: string | null }> } | null;
};

export type CreditRequestResult = { requestId: string; decision: CreditDecision | null };

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** The wallet the buyer already uses, from the browser (an extension, or a wallet app's own browser). */
async function connectHistoryWallet(): Promise<{ address: Address; provider: Eip1193 }> {
  const provider = (globalThis as { ethereum?: Eip1193 }).ethereum;
  if (!provider) {
    throw new Error("Open this page in your wallet app's browser, or in a browser with your wallet's extension, to connect it.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as unknown[];
  const first = accounts[0];
  if (typeof first !== "string" || !isAddress(first)) throw new Error("Your wallet didn't share an account.");
  return { address: getAddress(first), provider };
}

async function waitForDecision(account: Address, timeoutMs: number): Promise<CreditDecision | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const status = await api<{ request: { state: string; error: string | null } | null; decision: CreditDecision | null }>(`/api/public/credit/${account}`);
    if (status.decision) return status.decision;
    if (status.request?.state === "failed") throw new Error(status.request.error ?? "The review didn't go through. Try again.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

/**
 * Ask for a Pay in 4 line, optionally bringing a wallet's history. Resolves
 * with the workflow's decision once it arrives (up to `waitMs`), or null
 * while it is still being reviewed (the credit screen keeps polling).
 */
export async function requestCredit(opts: { withHistory?: boolean; waitMs?: number } = {}): Promise<CreditRequestResult> {
  // Face ID first, inside the tap: WebKit wants the passkey call to start in the user gesture.
  const account = await authorize();
  const history = opts.withHistory ? await connectHistoryWallet() : null;
  const m = await api<Messages>(`/api/public/credit/${account.address}/messages${history ? `?wallet=${history.address}` : ""}`);
  const consentSignature = await account.signMessage({ message: m.consent });
  let linked: { wallet: Address; issuedAt: number; nonce: string; signature: Hex } | undefined;
  if (history && m.link) {
    const signature = (await history.provider.request({ method: "personal_sign", params: [stringToHex(m.link), history.address] })) as Hex;
    linked = { wallet: history.address, issuedAt: m.issuedAt, nonce: m.nonce, signature };
  }
  const queued = await api<{ request: { id: string } }>("/api/credit/underwrite", {
    method: "POST",
    body: { account: account.address, consent: { issuedAt: m.issuedAt, nonce: m.nonce, signature: consentSignature }, ...(linked ? { linked } : {}) },
  });
  const decision = await waitForDecision(account.address, opts.waitMs ?? 90_000);
  notifyDataChanged();
  return { requestId: queued.request.id, decision };
}

/** "Raise your limit": bring the history of a wallet the buyer already uses. */
export async function bringHistory(): Promise<void> {
  if (!apiConfigured()) {
    // Offline demo: the sample ledger pretends a review happened. Nothing is underwritten.
    await new Promise((resolve) => setTimeout(resolve, 1400));
    mockLedger.linkHistory();
    return;
  }
  try {
    const { decision } = await requestCredit({ withHistory: true });
    if (decision && decision.status !== "applied") throw new Error(decision.reason ?? "We couldn't raise your limit this time.");
  } catch (error) {
    if (error instanceof ApiError) throw new Error(error.message);
    throw error;
  }
}
