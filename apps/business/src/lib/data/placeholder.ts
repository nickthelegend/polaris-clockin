import { payInFourQuote, PLAN_INSTALLMENTS, PLAN_INTERVAL_DAYS } from "./format";
import { linkUrl } from "./links";
import type {
  Address,
  Cents,
  CollectorStatus,
  LinkUsage,
  PayMode,
  Payment,
  PaymentLink,
  Payout,
  Plan,
} from "./types";

/**
 * A merchant's sample book.
 *
 * The server serves it only to a merchant created while no chain is
 * connected (`MerchantRecord.sample`); with a chain, everything shown comes
 * from the chain and a new merchant starts empty. The browser uses it for the
 * per-viewer "Preview with sample data" and the development mock session.
 *
 * It is deterministic per merchant (seeded from their ID), so a reload shows
 * the same book, and internally consistent: every Pay in 4 payment has a plan,
 * the balance is what was paid in since the last payout, and each payout is
 * what came in between it and the one before. The UI puts a "Sample" chip on
 * every card and row that shows it.
 */

export { linkUrl };
/** Merchant fee on direct payments and subscription charges. Pay in 4 pays the merchant 100%. */
export const MERCHANT_FEE_BPS = 50;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type SampleBook = {
  links: PaymentLink[];
  payments: Payment[];
  plans: Plan[];
  payouts: Payout[];
  balanceCents: Cents;
  collector: CollectorStatus;
};

/* ── A small seeded PRNG (mulberry32) ───────────────────────────────────── */

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const id = (length: number) => Array.from({ length }, () => pick(ID_ALPHABET.split(""))).join("");
  const hex = (bytes: number) =>
    Array.from({ length: bytes }, () => int(0, 255).toString(16).padStart(2, "0")).join("");
  return { next, int, pick, id, hex };
}

type Rng = ReturnType<typeof rng>;

/* ── Catalogue: a design studio, the plan's demo merchant ───────────────── */

const CATALOGUE: { description: string; cents: Cents; modes: PayMode[] }[] = [
  { description: "Brand identity package", cents: 200_00, modes: ["now", "later"] },
  { description: "Logo refresh", cents: 480_00, modes: ["now", "later"] },
  { description: "Website audit", cents: 150_00, modes: ["now"] },
  { description: "Monthly design retainer", cents: 900_00, modes: ["subscribe"] },
  { description: "Type licence, 3 seats", cents: 96_00, modes: ["now"] },
  { description: "Packaging mockups", cents: 320_00, modes: ["now", "later"] },
  { description: "Workshop seat, Buenos Aires", cents: 75_00, modes: ["now"] },
  { description: "Pitch deck design", cents: 640_00, modes: ["now", "later"] },
  { description: "Illustration set", cents: 260_00, modes: ["now", "later"] },
];

function address(r: Rng): Address {
  return `0x${r.hex(20)}`;
}

function feeFor(mode: PayMode, amount: Cents): Cents {
  return mode === "later" ? 0 : Math.round((amount * MERCHANT_FEE_BPS) / 10_000);
}

export function newLinkId(r: { id: (n: number) => string }): string {
  return r.id(10);
}

export function seedMerchantBook(merchantId: string, now = Date.now()): SampleBook {
  const r = rng(hashSeed(merchantId));

  /* Links: one per catalogue line, most reusable, a couple single-use. */
  const links: PaymentLink[] = CATALOGUE.map((item, i) => {
    const usage: LinkUsage = i % 4 === 2 ? "single" : "reusable";
    const createdAt = now - (34 - i * 3) * DAY - r.int(0, 20) * HOUR;
    const expired = i === 6;
    const id = newLinkId(r);
    return {
      id,
      url: linkUrl(id),
      amountCents: item.cents,
      description: item.description,
      modes: item.modes,
      usage,
      expiresAt: expired ? new Date(now - 2 * DAY).toISOString() : i === 3 ? new Date(now + 21 * DAY).toISOString() : null,
      status: expired ? "expired" : "active",
      paymentsCount: 0,
      collectedCents: 0,
      createdAt: new Date(createdAt).toISOString(),
    };
  });

  /* Payments: 30 days, a few already today. Newest first at the end. */
  const payments: Payment[] = [];
  const plans: Plan[] = [];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const hoursIntoToday = Math.max(1, Math.floor((now - startOfToday.getTime()) / HOUR));

  const times: number[] = [];
  for (let d = 30; d >= 1; d--) {
    const count = r.int(0, 3);
    for (let k = 0; k < count; k++) times.push(now - d * DAY + r.int(-10, 10) * HOUR);
  }
  // Today: spread over the hours that have actually passed.
  const todayCount = Math.min(6, Math.max(3, hoursIntoToday));
  for (let k = 0; k < todayCount; k++) {
    times.push(startOfToday.getTime() + Math.floor(((k + r.next()) / todayCount) * (now - startOfToday.getTime() - 60_000)));
  }
  times.sort((a, b) => a - b);

  let order = 1041;
  for (const t of times) {
    const linkIndex = r.int(0, links.length - 1);
    const link = links[linkIndex];
    const item = CATALOGUE[linkIndex];
    if (!link || !item) continue;
    // A single-use link pays once; an expired one stopped taking payments.
    if (link.usage === "single" && link.paymentsCount > 0) continue;
    if (link.expiresAt && new Date(link.expiresAt).getTime() < t) continue;
    if (new Date(link.createdAt).getTime() > t) continue;

    const mode: PayMode = r.pick(item.modes);
    const failed = mode !== "later" && r.next() < 0.05;
    const fee = feeFor(mode, item.cents);
    const orderId = `ord_${order++}`;
    const buyer = address(r);
    const createdAt = new Date(t).toISOString();

    payments.push({
      id: `pay_${r.id(14)}`,
      orderId,
      description: item.description,
      buyer,
      mode,
      status: failed ? "failed" : "succeeded",
      amountCents: item.cents,
      feeCents: failed ? 0 : fee,
      netCents: failed ? 0 : item.cents - fee,
      linkId: link.id,
      txHash: null,
      createdAt,
    });

    if (failed) continue;
    link.paymentsCount += 1;
    link.collectedCents += item.cents;
    if (link.usage === "single") link.status = "used";

    if (mode === "later") plans.push(planFor(r, orderId, item.description, buyer, item.cents, t, now));
  }

  /* A few older plans that have already closed, so "Closed" is not empty. */
  for (let k = 0; k < 4; k++) {
    const item = r.pick(CATALOGUE.filter((c) => c.modes.includes("later")));
    const openedAt = now - (40 + k * 6) * DAY;
    const quote = payInFourQuote(item.cents);
    const writtenOff = k === 3;
    const paid = writtenOff ? 1 : PLAN_INSTALLMENTS;
    plans.push({
      id: `plan_${r.id(12)}`,
      orderId: `ord_${1000 + k * 7}`,
      description: item.description,
      buyer: address(r),
      principalCents: item.cents,
      totalCents: quote.total,
      outstandingCents: writtenOff ? quote.total - quote.each : 0,
      installmentCount: PLAN_INSTALLMENTS,
      installmentsPaid: paid,
      state: writtenOff ? "written_off" : "repaid",
      attempts: writtenOff ? 5 : 0,
      nextDueAt: null,
      openedAt: new Date(openedAt).toISOString(),
    });
  }

  payments.reverse();
  plans.sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  /* Payouts: weekly manual withdrawals of what came in since the last one. */
  const destination = address(r);
  const payoutTimes = [26, 19, 12, 5].map((d) => now - d * DAY + 3 * HOUR);
  const payouts: Payout[] = [];
  let from = now - 40 * DAY;
  for (const t of payoutTimes) {
    const amount = sumNet(payments, from, t);
    if (amount > 0) {
      payouts.push({
        id: `po_${r.id(12)}`,
        kind: "manual",
        status: "paid",
        amountCents: amount,
        destination,
        signed: true,
        txHash: null,
        createdAt: new Date(t).toISOString(),
      });
    }
    from = t;
  }
  payouts.reverse();

  const balanceCents = sumNet(payments, from, now + 1);

  // Every record is marked, so a server that merges them with the
  // merchant's own links can label each row.
  const mark = <T extends object>(rows: T[]) => rows.map((row) => ({ ...row, sample: true }));
  return {
    links: mark(links.reverse()),
    payments: mark(payments),
    plans: mark(plans),
    payouts: mark(payouts),
    balanceCents,
    collector: { state: "running", lastPassAt: new Date(now - r.int(20, 90) * 1000).toISOString(), runner: "cre" },
  };
}

function sumNet(payments: Payment[], from: number, to: number): Cents {
  let total = 0;
  for (const p of payments) {
    const t = new Date(p.createdAt).getTime();
    if (p.status === "succeeded" && t >= from && t < to) total += p.netCents;
  }
  return total;
}

function planFor(
  r: Rng,
  orderId: string,
  description: string,
  buyer: Address,
  principal: Cents,
  openedAt: number,
  now: number,
): Plan {
  const quote = payInFourQuote(principal);
  const interval = PLAN_INTERVAL_DAYS * DAY;
  // Instalment k (1-based) falls due k intervals after checkout.
  const due = Math.min(PLAN_INSTALLMENTS, Math.floor((now - openedAt) / interval));
  const dunning = due > 0 && due < PLAN_INSTALLMENTS && r.next() < 0.22;
  const paid = dunning ? due - 1 : due;
  const outstanding = paid === 0 ? quote.total : quote.total - quote.each * paid;
  const repaid = paid >= PLAN_INSTALLMENTS;
  const nextIndex = paid + 1;

  return {
    id: `plan_${r.id(12)}`,
    orderId,
    description,
    buyer,
    principalCents: principal,
    totalCents: quote.total,
    outstandingCents: repaid ? 0 : outstanding,
    installmentCount: PLAN_INSTALLMENTS,
    installmentsPaid: Math.min(paid, PLAN_INSTALLMENTS),
    state: repaid ? "repaid" : dunning ? "dunning" : "collecting",
    attempts: dunning ? r.int(1, 3) : 0,
    nextDueAt: repaid ? null : new Date(openedAt + nextIndex * interval).toISOString(),
    openedAt: new Date(openedAt).toISOString(),
  };
}
