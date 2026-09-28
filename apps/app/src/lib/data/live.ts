import { type Address, getAddress, type Hex, parseAbi, zeroAddress } from "viem";
import { accountCreatedAt } from "../account";
import { api } from "../api";
import { publicClient } from "../chain";
import { resolveContract } from "../domains";
import type { Micros } from "../money";
import { prefsName } from "../prefs";
import { dataGeneration, hasDataListeners, notifyDataChanged, onDataChanged } from "./changes";
import { getRemotePaymentLink } from "./remote";
import type {
  ActivityItem,
  Balance,
  CreditLine,
  Instalment,
  Merchant,
  Plan,
  PolarisData,
  Profile,
  SendLinkStatus,
  Subscription,
} from "./types";

/**
 * The real data source, used whenever Polaris for Business is configured
 * (`NEXT_PUBLIC_POLARIS_API_URL`): nothing here is sample data.
 *
 * - Balance: `AUSD.balanceOf(owner)`, read from the chain.
 * - Credit line: `GET /api/public/credit/{owner}`, which reads ScoreManager
 *   (`creditLimitOf`, the score) and PolarisLoanEngine (`activeDebtOf`) now,
 *   and carries the CRE workflow's decision with its reasons, each from the
 *   provider behind it (Nansen, Zerion).
 * - Plans, subscriptions, activity: `GET /api/public/buyers/{owner}`, the
 *   records the API's chain sync keeps from PlanOpened, PaymentMade and the
 *   subscription events, and every other dollar in or out of the account
 *   (`moves`: money added, transfers, send links made and claimed,
 *   instalments), read from the chain's AUSD and PolarisSend logs.
 * - Member since: when this device created the account (Face ID's record,
 *   or the dev signer's), or its first move on chain.
 * - A send link: `PolarisSend.linkOf(linkKey)` and `keyUsed(linkKey)`.
 *
 * Contacts are a local address book the app doesn't keep yet: none, rather
 * than sample people with made-up addresses someone could send real money to.
 */

const ausdAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const sendAbi = parseAbi([
  "function linkOf(address linkKey) view returns ((address sender, uint128 amount, uint64 expiresAt))",
  "function keyUsed(address linkKey) view returns (bool)",
]);

type ApiMerchant = { id: string | null; name: string; address: Address };

type CreditStatus = {
  onChain: { underwritten: boolean; declined: boolean; score: number; creditLimitUnits: string; activeDebtUnits?: string } | null;
  decision: {
    status: "applied" | "refused" | "thin";
    score?: number | null;
    at?: string;
    reason: string | null;
    linkedWallet: Address | null;
    explanation: { reasons: Array<{ text: string; points: number | null; provider: string | null }> } | null;
  } | null;
};

type BuyerBook = {
  plans: Array<{
    id: string;
    merchant: ApiMerchant;
    principalUnits: string;
    totalOwedUnits: string;
    installments: number;
    installmentsPaid: number;
    intervalSeconds: number;
    startedAt: number;
    state: string;
    openedTxHash: Hex;
  }>;
  subscriptions: Array<{
    id: string;
    merchant: ApiMerchant;
    priceUnits: string;
    periodSeconds: number;
    nextChargeAt: number;
    status: "active" | "canceled" | "lapsed";
    createdAt: string;
  }>;
  payments: Array<{ id: string; kind: "now" | "later"; merchant: ApiMerchant; amountUnits: string; txHash: Hex; createdAt: string }>;
  /** Older APIs leave it out. */
  moves?: Array<{
    id: string;
    kind: "added" | "received" | "sent" | "sent-link" | "claimed" | "link-returned" | "payment" | "refund" | "instalment";
    direction: "in" | "out";
    amountUnits: string;
    counterparty: Address;
    txHash: Hex;
    linkKey: Address | null;
    settledAs: "claimed" | "returned" | null;
    settledAt: string | null;
    at: string;
  }>;
};

/** How the underwriting package names its providers. */
const PROVIDER_NAMES: Record<string, string> = { nansen: "Nansen", zerion: "Zerion", etherscan: "Etherscan", rpc: "the chain" };

/** Plans still being paid, in the API's words (and the older ones). */
const OPEN_PLAN_STATES = new Set(["collecting", "dunning", "active", "overdue"]);

/** The most an opening line can be (ScoreManager's opening cap). */
const OPENING_CAP = 1_000_000_000n;

/** Polaris Pay in 4's rate (PolarisLoanEngine.INTEREST_RATE_BPS). */
const APR_BPS = 1000;

function merchantOf(m: ApiMerchant): Merchant {
  return { id: m.id ?? m.address, name: m.name, address: getAddress(m.address), city: "", country: "", category: "" };
}

/** The loan engine's instalment ladder: instalment i is ceil(total·(i+1)/n) − ceil(total·i/n). */
export function instalmentAmounts(total: Micros, n: number): Micros[] {
  const N = BigInt(n);
  const threshold = (k: bigint) => (total * k + N - 1n) / N;
  return Array.from({ length: n }, (_, i) => threshold(BigInt(i + 1)) - threshold(BigInt(i)));
}

export function toPlan(p: BuyerBook["plans"][number]): Plan {
  const total = BigInt(p.totalOwedUnits);
  const principal = BigInt(p.principalUnits);
  const amounts = instalmentAmounts(total, p.installments);
  const instalments: Instalment[] = amounts.map((amount, i) => {
    const dueAt = (p.startedAt + (i + 1) * p.intervalSeconds) * 1000;
    // 0-based, as every screen counts them ("1 of 4" is index 0).
    return { index: i, amount, dueAt, paidAt: i < p.installmentsPaid ? Math.min(dueAt, Date.now()) : null };
  });
  return {
    id: p.id,
    loanId: BigInt(p.id),
    merchant: merchantOf(p.merchant),
    description: `Pay in ${p.installments}`,
    principal,
    interest: total - principal,
    interval: p.intervalSeconds,
    instalments,
    // The API's plan states (the chain sync's): collecting and dunning are open; repaid and written off are done.
    status: OPEN_PLAN_STATES.has(p.state) ? "active" : "completed",
    openedAt: p.startedAt * 1000,
  };
}

function toSubscription(s: BuyerBook["subscriptions"][number]): Subscription {
  return {
    id: s.id,
    subId: BigInt(s.id),
    merchant: merchantOf(s.merchant),
    name: s.merchant.name,
    price: BigInt(s.priceUnits),
    periodSeconds: s.periodSeconds,
    nextChargeAt: s.nextChargeAt * 1000,
    startedAt: Date.parse(s.createdAt),
    status: s.status === "active" ? "active" : "cancelled",
  };
}

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Move = NonNullable<BuyerBook["moves"]>[number];

/** A move the payment rows don't already show, as the row the buyer reads. */
function moveRow(m: Move, merchants: Map<string, Merchant>): ActivityItem | null {
  const base = { id: `move-${m.id}`, direction: m.direction, amount: BigInt(m.amountUnits), at: Date.parse(m.at), txHash: m.txHash, status: "settled" as const };
  const merchant = merchants.get(m.counterparty.toLowerCase());
  const who = merchant ? { kind: "merchant" as const, name: merchant.name } : { kind: "person" as const, name: short(m.counterparty) };
  switch (m.kind) {
    case "added":
      return { ...base, kind: "added", title: "Added money", detail: "To your dollar account", counterparty: { kind: "polaris", name: "Added money" } };
    case "received":
      return { ...base, kind: "received", title: who.name, detail: "Received", counterparty: who };
    case "sent":
      return { ...base, kind: "sent", title: who.name, detail: "Sent", counterparty: who };
    case "sent-link":
      return {
        ...base,
        kind: "sent-link",
        title: "Link for anyone",
        detail: m.settledAs === "claimed" ? "Claimed" : m.settledAs === "returned" ? "Cancelled" : "Waiting to be claimed",
        counterparty: { kind: "polaris", name: "Link for anyone" },
        ...(m.linkKey ? { linkKey: getAddress(m.linkKey) } : {}),
        ...(m.settledAt ? { settledAt: Date.parse(m.settledAt) } : {}),
      };
    case "claimed":
      return { ...base, kind: "claimed", title: "Sent by link", detail: "Link claimed", counterparty: { kind: "polaris", name: "Send link" } };
    case "link-returned":
      return { ...base, kind: "refund", title: "Link cancelled", detail: "Back in your account", counterparty: { kind: "polaris", name: "Link cancelled" } };
    case "refund":
      return { ...base, kind: "refund", title: merchant?.name ?? "Refund", detail: "Refund", counterparty: { kind: "merchant", name: merchant?.name ?? "Refund" } };
    case "instalment":
      return { ...base, kind: "instalment", title: "Pay in 4", detail: "Instalment paid", counterparty: { kind: "polaris", name: "Pay in 4" } };
    case "payment":
      return null;
  }
}

function toActivity(book: BuyerBook): ActivityItem[] {
  const items: ActivityItem[] = book.payments.map((p) => ({
    id: `pay-${p.id}`,
    kind: p.kind === "later" ? "plan-opened" : "payment",
    title: p.merchant.name,
    detail: p.kind === "later" ? "Pay in 4" : "Paid in full",
    direction: "out",
    amount: BigInt(p.amountUnits),
    at: Date.parse(p.createdAt),
    counterparty: { kind: "merchant", name: p.merchant.name },
    txHash: p.txHash,
    status: "settled",
  }));
  const merchants = new Map<string, Merchant>();
  for (const r of [...book.plans, ...book.subscriptions, ...book.payments]) merchants.set(r.merchant.address.toLowerCase(), merchantOf(r.merchant));
  const shown = new Set(book.payments.map((p) => p.txHash.toLowerCase()));
  const moves = book.moves ?? [];
  for (const m of moves) {
    const row = moveRow(m, merchants);
    if (row) items.push(row);
  }
  // A payment's transfers the payment rows don't cover (a subscription's monthly charge): one row per transaction.
  const unshown = new Map<string, Move[]>();
  for (const m of moves) if (m.kind === "payment" && !shown.has(m.txHash.toLowerCase())) unshown.set(m.txHash, [...(unshown.get(m.txHash) ?? []), m]);
  for (const [txHash, parts] of unshown) {
    const to = parts.map((p) => merchants.get(p.counterparty.toLowerCase())).find((m): m is Merchant => m !== undefined);
    const subscribed = to !== undefined && book.subscriptions.some((s) => s.merchant.address.toLowerCase() === to.address.toLowerCase());
    items.push({
      id: `move-${parts[0]!.id}`,
      kind: subscribed ? "subscription" : "payment",
      title: to?.name ?? "Payment",
      detail: subscribed ? "Subscription" : "Paid in full",
      direction: "out",
      amount: parts.reduce((s, p) => s + BigInt(p.amountUnits), 0n),
      at: Date.parse(parts[0]!.at),
      counterparty: to ? { kind: "merchant", name: to.name } : { kind: "polaris", name: "Payment" },
      txHash: txHash as Hex,
      status: "settled",
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

type Shared<T> = Map<string, { generation: number; at: number; value: Promise<T> }>;

/**
 * One request per owner per change: every screen reads the book when data
 * changes (a relay, a review, the 15 s tick), and they share it. A read more
 * than a few seconds after the last one fetches again.
 */
function shared<T>(cache: Shared<T>, key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.generation === dataGeneration() && Date.now() - hit.at < 5_000) return hit.value;
  const value = read();
  cache.set(key, { generation: dataGeneration(), at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

const books: Shared<BuyerBook> = new Map();
const credits: Shared<CreditStatus> = new Map();

function book(owner: Address): Promise<BuyerBook> {
  return shared(books, owner.toLowerCase(), () => api<BuyerBook>(`/api/public/buyers/${owner}`));
}

function creditStatus(owner: Address): Promise<CreditStatus> {
  return shared(credits, owner.toLowerCase(), () => api<CreditStatus>(`/api/public/credit/${owner}`));
}

/** The first thing the chain shows for this owner, in ms, or null. */
function firstSeen(b: BuyerBook): number | null {
  const times = [
    ...(b.moves ?? []).map((m) => Date.parse(m.at)),
    ...b.payments.map((p) => Date.parse(p.createdAt)),
    ...b.plans.map((p) => p.startedAt * 1000),
    ...b.subscriptions.map((s) => Date.parse(s.createdAt)),
  ].filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const liveData: PolarisData = {
  async getProfile(owner): Promise<Profile> {
    // The name is the one the buyer chose on this device (their send links carry it).
    const created = accountCreatedAt(owner);
    const seen = owner ? await book(owner).then(firstSeen, () => null) : null;
    const known = [created, seen].filter((t): t is number => t !== null);
    return { name: prefsName(), memberSince: known.length ? Math.min(...known) : Date.now() };
  },

  async getBalance(owner): Promise<Balance> {
    if (!owner) return { available: 0n, updatedAt: Date.now() };
    const ausd = await resolveContract("ausd");
    const available = ausd === zeroAddress ? 0n : await publicClient().readContract({ address: ausd, abi: ausdAbi, functionName: "balanceOf", args: [owner] });
    return { available, updatedAt: Date.now() };
  },

  async getCreditLine(owner): Promise<CreditLine> {
    const empty: CreditLine = {
      limit: 0n,
      available: 0n,
      used: 0n,
      score: 0,
      aprBps: APR_BPS,
      nextPayment: null,
      reasons: [],
      historyLinked: false,
      openingCap: OPENING_CAP,
      openedAt: null,
      openingScore: null,
    };
    if (!owner) return empty;
    const [status, plans] = await Promise.all([creditStatus(owner), book(owner).then((b) => b.plans.map(toPlan))]);
    const limit = BigInt(status.onChain?.creditLimitUnits ?? "0");
    const used = BigInt(status.onChain?.activeDebtUnits ?? "0");
    let nextPayment: CreditLine["nextPayment"] = null;
    for (const plan of plans) {
      if (plan.status !== "active") continue;
      const due = plan.instalments.find((i) => i.paidAt === null);
      if (due && (!nextPayment || due.dueAt < nextPayment.dueAt)) nextPayment = { amount: due.amount, dueAt: due.dueAt, merchant: plan.merchant.name, planId: plan.id };
    }
    // The CRE decision's reasons, explained by @polarispay/underwriting, each with the provider behind it.
    const reasons = (status.decision?.explanation?.reasons ?? []).map((r) => ({
      label: r.text.replace(/ · [+\-−]?\d+$/, ""),
      points: r.points ?? 0,
      // Named only when a provider supplied the fact; the chain itself carries just the facts.
      source: r.provider ? (PROVIDER_NAMES[r.provider] ?? null) : null,
    }));
    return {
      limit,
      available: limit > used ? limit - used : 0n,
      used,
      score: status.onChain?.score ?? 0,
      aprBps: APR_BPS,
      nextPayment,
      reasons,
      historyLinked: Boolean(status.decision?.linkedWallet),
      // ScoreManager caps an opening line at $1,000; paying on time raises it from there.
      openingCap: limit > OPENING_CAP ? limit : OPENING_CAP,
      // The line and its score start at the CRE decision that opened them.
      openedAt: limit > 0n && status.decision?.status === "applied" && status.decision.at ? Date.parse(status.decision.at) : null,
      openingScore: status.decision?.status === "applied" ? (status.decision.score ?? null) : null,
    };
  },

  async getPlans(owner) {
    if (!owner) return { plans: [], subscriptions: [] };
    const b = await book(owner);
    return { plans: b.plans.map(toPlan), subscriptions: b.subscriptions.map(toSubscription) };
  },

  async getActivity(owner) {
    if (!owner) return [];
    return toActivity(await book(owner));
  },

  async getContacts() {
    return [];
  },

  getPaymentLink: (id) => getRemotePaymentLink(id),

  async getSendLink(linkKey): Promise<SendLinkStatus | null> {
    const send = await resolveContract("send");
    if (send === zeroAddress) return null;
    const client = publicClient();
    const [link, used] = await Promise.all([
      client.readContract({ address: send, abi: sendAbi, functionName: "linkOf", args: [linkKey] }),
      client.readContract({ address: send, abi: sendAbi, functionName: "keyUsed", args: [linkKey] }),
    ]);
    const key = getAddress(linkKey);
    if (link.sender === zeroAddress) {
      // Settled (claimed or cancelled: the chain keeps only that the key was used), or not sent yet.
      return used ? { linkKey: key, amount: null, senderName: null, status: "claimed", expiresAt: null, settledAt: null } : null;
    }
    const expiresAt = Number(link.expiresAt) * 1000;
    return { linkKey: key, amount: link.amount, senderName: null, status: expiresAt <= Date.now() ? "expired" : "open", expiresAt, settledAt: null };
  },

  subscribe(listener) {
    const off = onDataChanged(listener);
    timer ??= setInterval(notifyDataChanged, 15_000);
    return () => {
      off();
      if (!hasDataListeners() && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  },
};
