import type { Cents, IsoDate, Payment, Plan, WebhookEventType } from "./types";

/**
 * The sponsor-backed panels on the Overview, behind one typed function each:
 *
 * | Panel | Service | Function |
 * |---|---|---|
 * | Collections | Chainlink CRE `collections` workflow | `getCollectionsRun` |
 * | Indexed events | Envio HyperIndex on Monad | `getIndexedEvents` |
 * | Credit exposure reasons | Nansen wallet history (underwriting) | `getUnderwritingReasons` |
 *
 * None of those services reports to the dashboard yet. Each function returns
 * `{ source: "not_connected" }` for a live merchant, so the panel says so,
 * and `{ source: "placeholder" }` with realistic data only when sample data
 * is on, so the panel carries a "Sample" chip. The `placeholder*` builders
 * are named for what they are; wiring a service means replacing one of them
 * with a fetch and returning `{ source: "live" }`.
 */

export type Sourced<T> =
  | { source: "live"; data: T }
  | { source: "placeholder"; data: T }
  | { source: "not_connected"; reason: string };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/* ── Chainlink CRE: the collections workflow ────────────────────────────── */

export type CollectionsRun = {
  workflow: string;
  /** When it runs, in words. */
  schedule: string;
  lastRun: {
    at: IsoDate;
    /** Plans the workflow looked at. */
    checked: number;
    /** Instalments it collected. */
    collected: number;
    collectedCents: Cents;
    /** Collections that failed and entered the retry ladder. */
    retrying: number;
    /** Why items were skipped, in the words the merchant sees. */
    skipped: { reason: string; count: number }[];
  };
  nextRunAt: IsoDate;
  /** The last few runs, oldest first: instalments collected per run. */
  history: number[];
};

// TODO(wire): replace with GET /api/collector (the CRE workflow's report receiver posts a heartbeat after each run).
export function placeholderCollectionsRun(plans: Plan[], now = Date.now()): CollectionsRun {
  const open = plans.filter((p) => p.state === "collecting" || p.state === "dunning");
  const retrying = plans.filter((p) => p.state === "dunning").length;
  // Runs start 4 s past each minute; the last one is the latest start before now.
  let lastAt = Math.floor(now / MINUTE) * MINUTE + 4 * SECOND;
  if (lastAt > now) lastAt -= MINUTE;
  const due = open.filter((p) => p.nextDueAt && Math.abs(new Date(p.nextDueAt).getTime() - now) < DAY);
  const collected = Math.min(due.length, 2);
  const each = collected ? Math.round(due.slice(0, collected).reduce((s, p) => s + p.totalCents / p.installmentCount, 0)) : 0;
  return {
    workflow: "polaris-collections",
    schedule: "Every minute",
    lastRun: {
      at: new Date(lastAt).toISOString(),
      checked: open.length,
      collected,
      collectedCents: each,
      retrying,
      skipped: retrying ? [{ reason: "Not enough in the buyer's account, retrying in 6 hours", count: retrying }] : [],
    },
    nextRunAt: new Date(lastAt + MINUTE).toISOString(),
    history: [0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, collected],
  };
}

export function getCollectionsRun({ sample, plans }: { sample: boolean; plans: Plan[] }): Sourced<CollectionsRun> {
  if (sample) return { source: "placeholder", data: placeholderCollectionsRun(plans) };
  return {
    source: "not_connected",
    reason: "The collections workflow runs on Chainlink CRE every minute once it's deployed. Its runs appear here when it starts reporting.",
  };
}

/* ── Envio: indexed chain events ────────────────────────────────────────── */

export type IndexedEvent = {
  id: string;
  type: WebhookEventType;
  /** What happened, in words: "Brand identity package". */
  title: string;
  amountCents: Cents;
  block: number;
  txHash: string;
  at: IsoDate;
};

/** Monad testnet makes a block every 400 ms; anchor block numbers to a time. */
const BLOCK_ANCHOR = { block: 41_250_000, at: Date.UTC(2026, 8, 20) };

function blockAt(t: number) {
  return BLOCK_ANCHOR.block + Math.floor((t - BLOCK_ANCHOR.at) / 400);
}

function fakeHash(seed: string) {
  let h = 2166136261;
  let out = "";
  for (let i = 0; out.length < 64; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, 64)}`;
}

// TODO(wire): replace with the Envio indexer's GraphQL endpoint (latest PolarisPayments, PolarisLoanEngine and Subscriptions events for this merchant).
export function placeholderIndexedEvents(payments: Payment[], plans: Plan[], now = Date.now()): IndexedEvent[] {
  const events: IndexedEvent[] = [];
  for (const p of payments.slice(0, 14)) {
    if (p.status !== "succeeded") continue;
    const t = new Date(p.createdAt).getTime();
    const type: WebhookEventType = p.mode === "later" ? "plan.opened" : p.mode === "subscribe" ? "subscription.charged" : "payment.succeeded";
    events.push({ id: `${p.id}:${type}`, type, title: p.description, amountCents: p.amountCents, block: blockAt(t), txHash: fakeHash(p.id), at: p.createdAt });
  }
  for (const plan of plans) {
    const opened = new Date(plan.openedAt).getTime();
    for (let k = 1; k <= plan.installmentsPaid; k++) {
      const t = opened + k * WEEK;
      if (t > now || t < now - 3 * DAY) continue;
      events.push({
        id: `${plan.id}:${k}`,
        type: k === plan.installmentCount ? "plan.completed" : "installment.collected",
        title: `${plan.description}, instalment ${k} of ${plan.installmentCount}`,
        amountCents: Math.floor(plan.totalCents / plan.installmentCount),
        block: blockAt(t),
        txHash: fakeHash(`${plan.id}${k}`),
        at: new Date(t).toISOString(),
      });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
}

export function getIndexedEvents({ sample, payments, plans }: { sample: boolean; payments: Payment[]; plans: Plan[] }): Sourced<IndexedEvent[]> {
  if (sample) return { source: "placeholder", data: placeholderIndexedEvents(payments, plans) };
  return {
    source: "not_connected",
    reason: "Payments, plans and payouts stream in here as the Envio indexer picks them up from Monad, a second or so after they settle.",
  };
}

/** A fresh sample event, for the feed's "live" ticker in sample mode. */
export function placeholderNextEvent(seq: number, now = Date.now()): IndexedEvent {
  const pool: { type: WebhookEventType; title: string; cents: Cents }[] = [
    { type: "payment.succeeded", title: "Workshop seat", cents: 75_00 },
    { type: "plan.opened", title: "Brand identity package", cents: 200_00 },
    { type: "installment.collected", title: "Logo refresh, instalment 2 of 4", cents: 121_83 },
    { type: "subscription.charged", title: "Social kit, monthly", cents: 120_00 },
    { type: "payment.succeeded", title: "Icon pack", cents: 48_00 },
    { type: "payment.succeeded", title: "Type licence, 3 seats", cents: 96_00 },
  ];
  const e = pool[seq % pool.length]!;
  return {
    id: `live-${seq}`,
    type: e.type,
    title: e.title,
    amountCents: e.cents,
    block: blockAt(now),
    txHash: fakeHash(`live${seq}`),
    at: new Date(now).toISOString(),
  };
}

/* ── Nansen: why buyers got credit ──────────────────────────────────────── */

export type UnderwritingReason = {
  /** Plain language, as the buyer sees it in the app. */
  text: string;
  /** Points toward the score (negative lowers it). */
  points: number;
  /** Where the fact came from. */
  source: "Nansen" | "Zerion" | "Polaris";
};

export type Underwriting = {
  /** Buyers underwritten for plans still open. */
  buyers: number;
  /** The reasons that moved those decisions most, strongest first. */
  reasons: UnderwritingReason[];
  /** Plans opened on a line below the $1,000 starting cap. */
  averageLineCents: Cents;
};

// TODO(wire): replace with GET /api/underwriting/summary (the CRE `underwrite` workflow's attested facts, scored on chain by ScoreManager).
export function placeholderUnderwriting(plans: Plan[]): Underwriting {
  const open = plans.filter((p) => p.state === "collecting" || p.state === "dunning");
  return {
    buyers: new Set(open.map((p) => p.buyer)).size,
    averageLineCents: 500_00,
    reasons: [
      { text: "First funded from a major exchange", points: 10, source: "Nansen" },
      { text: "Two or more years of wallet history", points: 8, source: "Nansen" },
      { text: "Paid back earlier plans on time", points: 12, source: "Polaris" },
      { text: "No liquidations on record", points: 6, source: "Zerion" },
      { text: "Not linked to a cluster of related wallets", points: 5, source: "Nansen" },
    ],
  };
}

export function getUnderwritingReasons({ sample, plans }: { sample: boolean; plans: Plan[] }): Sourced<Underwriting> {
  if (sample) return { source: "placeholder", data: placeholderUnderwriting(plans) };
  return {
    source: "not_connected",
    reason: "When a buyer picks Pay in 4, Chainlink CRE nodes fetch their wallet history from Nansen and the score is computed on chain. The reasons behind your buyers' lines show here once underwriting reports.",
  };
}
