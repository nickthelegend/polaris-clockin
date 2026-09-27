import { type Address, getAddress, type Hex, keccak256, stringToHex } from "viem";
import { dollars, type Micros } from "../money";
import { DAY, dueAt, quotePlan, WEEK } from "./quote";
import type {
  ActivityItem,
  Balance,
  CreditLine,
  CreditReason,
  Merchant,
  PaymentLink,
  Person,
  Plan,
  PolarisData,
  Profile,
  SendLinkStatus,
  Subscription,
} from "./types";

/**
 * Placeholder data: one realistic account, a Berlin buyer three months in.
 *
 * Everything is relative to when the page loaded, so the demo never goes
 * stale. The stub relayer writes to the ledger below, so paying, sending and
 * claiming show up across screens for the rest of the session. A later step
 * replaces this file with chain reads and the Envio indexer.
 */

const MS_DAY = DAY * 1000;
const MS_HOUR = 3_600_000;
const APR_BPS = 1000;
const OPENING_CAP = dollars(1000);
const SCORE_FLOOR = 520;

const fakeAddress = (seed: string): Address => getAddress(keccak256(stringToHex(seed)).slice(0, 42));
const fakeTx = (seed: string): Hex => keccak256(stringToHex(`tx:${seed}`));

const merchants = {
  studioSol: {
    id: "studio-sol",
    name: "Studio Sol",
    address: fakeAddress("merchant:studio-sol"),
    city: "Buenos Aires",
    country: "AR",
    category: "Design studio",
  },
  lumen: {
    id: "lumen-audio",
    name: "Lumen Audio",
    address: fakeAddress("merchant:lumen-audio"),
    city: "Berlin",
    country: "DE",
    category: "Audio gear",
  },
  kora: {
    id: "kora-rail",
    name: "Kora Rail",
    address: fakeAddress("merchant:kora-rail"),
    city: "Lisbon",
    country: "PT",
    category: "Travel",
  },
  nomada: {
    id: "nomada-coffee",
    name: "Nómada Coffee",
    address: fakeAddress("merchant:nomada-coffee"),
    city: "Berlin",
    country: "DE",
    category: "Café",
  },
  kinetik: {
    id: "kinetik",
    name: "Kinetik Gym",
    address: fakeAddress("merchant:kinetik"),
    city: "Berlin",
    country: "DE",
    category: "Fitness",
  },
  figura: {
    id: "figura",
    name: "Figura",
    address: fakeAddress("merchant:figura"),
    city: "London",
    country: "GB",
    category: "Design software",
  },
} satisfies Record<string, Merchant>;

const people: Person[] = [
  { id: "marisol", name: "Marisol Reyes", country: "PH", handle: "+63 917 555 0142" },
  { id: "jonas", name: "Jonas Weber", country: "DE", handle: "@jonasw" },
  { id: "ana", name: "Ana Souza", country: "BR", handle: "+55 11 95555 0199" },
  { id: "tomas", name: "Tomás García", country: "AR", handle: "@tomasg" },
  { id: "aisha", name: "Aisha Bello", country: "NG", handle: "+234 803 555 0107" },
];

const links: Record<string, Omit<PaymentLink, "status">> = {
  "sol-brand": {
    id: "sol-brand",
    merchant: merchants.studioSol,
    description: "Brand identity package",
    amount: dollars(200),
    orderId: "SOL-2026-0142",
    modes: { now: true, later: quotePlan(dollars(200), 4, WEEK, APR_BPS), subscription: null },
    successUrl: null,
  },
  kinetik: {
    id: "kinetik",
    merchant: merchants.kinetik,
    description: "Monthly membership",
    amount: dollars(29),
    orderId: "KIN-M-5512",
    modes: {
      now: true,
      later: null,
      subscription: {
        planId: 3n,
        name: "Monthly membership",
        price: dollars(29),
        periodSeconds: 30 * DAY,
        periodsAuthorised: 12,
      },
    },
    successUrl: null,
  },
  "nomada-order": {
    id: "nomada-order",
    merchant: merchants.nomada,
    description: "Flat white and a croissant",
    amount: dollars(7.8),
    orderId: "NOM-88213",
    modes: { now: true, later: null, subscription: null },
    successUrl: null,
  },
  "lumen-monitors": {
    id: "lumen-monitors",
    merchant: merchants.lumen,
    description: "Studio monitors, pair",
    amount: dollars(640),
    orderId: "LUM-30871",
    modes: { now: true, later: quotePlan(dollars(640), 4, WEEK, APR_BPS), subscription: null },
    successUrl: null,
  },
};

/** The demo links, for the Pay screen's "Try a link" list. */
export const DEMO_LINK_IDS = Object.keys(links);

/* ── The session ledger ─────────────────────────────────────────────────── */

const loadedAt = Date.now();

function planFrom(
  id: string,
  loanId: bigint,
  merchant: Merchant,
  description: string,
  principal: Micros,
  openedAt: number,
  paid: number,
): Plan {
  const quote = quotePlan(principal, 4, WEEK, APR_BPS);
  // Nothing is due when a plan opens: the first payment is a week later.
  const instalments = quote.amounts.map((amount, index) => {
    const due = dueAt(openedAt, WEEK, index);
    return { index, amount, dueAt: due, paidAt: index < paid ? due : null };
  });
  return {
    id,
    loanId,
    merchant,
    description,
    principal,
    interest: quote.interest,
    interval: WEEK,
    instalments,
    status: paid >= 4 ? "completed" : "active",
    openedAt,
  };
}

type Ledger = {
  balance: Micros;
  historyLinked: boolean;
  plans: Plan[];
  subscriptions: Subscription[];
  activity: ActivityItem[];
  sendLinks: Map<Address, SendLinkStatus>;
  nextLoanId: bigint;
  nextSubId: bigint;
};

function seed(): Ledger {
  const t = loadedAt;
  // Opened 15, 9 and 40 days ago; each paid instalment was paid on its due day.
  const lumen = planFrom("plan-lumen", 41n, merchants.lumen, "Studio headphones", dollars(240), t - 15 * MS_DAY - 4 * MS_HOUR, 2);
  const kora = planFrom("plan-kora", 44n, merchants.kora, "Lisbon to Porto rail pass", dollars(120), t - 9 * MS_DAY - 3 * MS_HOUR, 1);
  const grinder = planFrom("plan-nomada", 29n, merchants.nomada, "Espresso grinder", dollars(180), t - 40 * MS_DAY, 4);

  const item = (
    id: string,
    kind: ActivityItem["kind"],
    counterparty: ActivityItem["counterparty"],
    detail: string,
    direction: ActivityItem["direction"],
    amount: Micros,
    at: number,
    planId?: string,
  ): ActivityItem => ({
    id,
    kind,
    title: counterparty.name,
    detail,
    direction,
    amount,
    at,
    counterparty,
    txHash: fakeTx(id),
    status: "settled",
    ...(planId ? { planId } : {}),
  });

  const m = (merchant: Merchant) => ({ kind: "merchant" as const, name: merchant.name });
  const p = (person: Person) => ({ kind: "person" as const, name: person.name, country: person.country });
  const [marisol, jonas, ana] = people as [Person, Person, Person];

  return {
    balance: dollars(1284.5),
    historyLinked: false,
    plans: [lumen, kora, grinder],
    subscriptions: [
      {
        id: "sub-kinetik",
        subId: 7n,
        merchant: merchants.kinetik,
        name: "Monthly membership",
        price: dollars(29),
        periodSeconds: 30 * DAY,
        nextChargeAt: t + 21 * MS_DAY,
        startedAt: t - 39 * MS_DAY,
        status: "active",
      },
      {
        id: "sub-figura",
        subId: 12n,
        merchant: merchants.figura,
        name: "Figura Pro",
        price: dollars(12),
        periodSeconds: 30 * DAY,
        nextChargeAt: t + 12 * MS_DAY,
        startedAt: t - 78 * MS_DAY,
        status: "active",
      },
    ],
    activity: [
      item("a-lumen-2", "instalment", m(merchants.lumen), "Studio headphones · 2 of 4", "out", lumen.instalments[1]!.amount, lumen.instalments[1]!.dueAt, lumen.id),
      item("a-marisol", "sent-link", p(marisol), "Sent by link", "out", dollars(50), t - 30 * MS_HOUR),
      item("a-kora-1", "instalment", m(merchants.kora), "Rail pass · 1 of 4", "out", kora.instalments[0]!.amount, kora.instalments[0]!.dueAt, kora.id),
      item("a-nomada", "payment", m(merchants.nomada), "Flat white and a croissant", "out", dollars(7.8), t - 4 * MS_DAY - 5 * MS_HOUR),
      item("a-jonas", "received", p(jonas), "Received", "in", dollars(1000), t - 6 * MS_DAY - 2 * MS_HOUR),
      item("a-lumen-1", "instalment", m(merchants.lumen), "Studio headphones · 1 of 4", "out", lumen.instalments[0]!.amount, lumen.instalments[0]!.dueAt, lumen.id),
      item("a-kora-0", "plan-opened", m(merchants.kora), "Lisbon to Porto rail pass", "out", kora.principal, kora.openedAt, kora.id),
      item("a-kinetik", "subscription", m(merchants.kinetik), "Monthly membership", "out", dollars(29), t - 9 * MS_DAY - 4 * MS_HOUR),
      item("a-ana", "claimed", p(ana), "Link claimed", "in", dollars(75), t - 12 * MS_DAY - 7 * MS_HOUR),
      item("a-nomada-4", "instalment", m(merchants.nomada), "Espresso grinder · 4 of 4", "out", grinder.instalments[3]!.amount, grinder.instalments[3]!.dueAt, grinder.id),
      item("a-lumen-0", "plan-opened", m(merchants.lumen), "Studio headphones", "out", lumen.principal, lumen.openedAt, lumen.id),
      item("a-figura", "subscription", m(merchants.figura), "Figura Pro", "out", dollars(12), t - 18 * MS_DAY),
      item("a-added", "added", { kind: "polaris", name: "Added money" }, "From your bank", "in", dollars(500), t - 21 * MS_DAY),
    ],
    sendLinks: new Map(),
    nextLoanId: 52n,
    nextSubId: 19n,
  };
}

let ledger = seed();
const listeners = new Set<() => void>();
/** Send link → its "Waiting to be claimed" activity row, to update on claim. */
const sendActivity = new Map<Address, string>();

function changed(): void {
  for (const listener of listeners) listener();
}

function newTxItem(partial: Omit<ActivityItem, "id" | "at" | "status">): ActivityItem {
  const at = Date.now();
  return { ...partial, id: `a-${at}-${Math.random().toString(36).slice(2, 7)}`, at, status: "settled" };
}

/* ── Credit, computed from the ledger ───────────────────────────────────── */

function band(score: number): Micros {
  if (score >= 670) return dollars(1000);
  if (score >= 580) return dollars(500);
  return dollars(200);
}

function creditLine(): CreditLine {
  const paidOnTime = ledger.plans.reduce((n, plan) => n + plan.instalments.filter((i) => i.paidAt !== null).length, 0);
  const reasons: CreditReason[] = [
    { label: `${paidOnTime} instalments paid on time`, points: paidOnTime * 12 },
    { label: "No late payments", points: 20 },
    { label: "Account open 3 months", points: 6 },
  ];
  if (ledger.historyLinked) {
    // Bring your history (§5.5): facts about a wallet the buyer already used.
    reasons.push(
      { label: "Wallet first used 3 years ago", points: 60 },
      { label: "Funded from a major exchange", points: 10 },
      { label: "Held dollars for 2 years", points: 20 },
    );
  }
  const score = Math.min(850, SCORE_FLOOR + reasons.reduce((sum, r) => sum + r.points, 0));
  const limit = band(score) > OPENING_CAP ? OPENING_CAP : band(score);
  let used = 0n;
  let next: CreditLine["nextPayment"] = null;
  for (const plan of ledger.plans) {
    if (plan.status !== "active") continue;
    for (const inst of plan.instalments) {
      if (inst.paidAt !== null) continue;
      used += inst.amount;
      if (!next || inst.dueAt < next.dueAt) {
        next = { amount: inst.amount, dueAt: inst.dueAt, merchant: plan.merchant.name, planId: plan.id };
      }
    }
  }
  const available = limit > used ? limit - used : 0n;
  return {
    limit,
    available,
    used,
    score,
    aprBps: APR_BPS,
    nextPayment: next,
    reasons,
    historyLinked: ledger.historyLinked,
    openingCap: OPENING_CAP,
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

const settle = <T>(value: T, ms = 140): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const mockData: PolarisData = {
  getProfile: () => settle<Profile>({ name: "Lena Vogel", memberSince: loadedAt - 92 * MS_DAY }),
  getBalance: () => settle<Balance>({ available: ledger.balance, updatedAt: Date.now() }),
  getCreditLine: () => settle(creditLine()),
  getPlans: () =>
    settle({
      plans: ledger.plans.map((plan) => ({ ...plan, instalments: plan.instalments.map((i) => ({ ...i })) })),
      subscriptions: ledger.subscriptions.map((s) => ({ ...s })),
    }),
  getActivity: () => settle([...ledger.activity].sort((a, b) => b.at - a.at)),
  getContacts: () => settle(people),
  getPaymentLink: (id) => {
    const link = links[id];
    return settle(link ? { ...link, status: "open" as const } : null, 60);
  },
  getSendLink: (linkKey) => {
    // The mock only knows links sent from this tab. Anything else is treated
    // as open, so a link opened on a second device can still be claimed.
    const known = ledger.sendLinks.get(getAddress(linkKey));
    return settle(
      known ?? {
        linkKey: getAddress(linkKey),
        amount: null,
        senderName: null,
        status: "open" as const,
        expiresAt: null,
        settledAt: null,
      },
      80,
    );
  },
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/* ── Writes, driven only by the stub relayer ────────────────────────────── */

export const mockLedger = {
  /** Spendable balance right now, for the stub relayer's checks. */
  balance(): Micros {
    return ledger.balance;
  },

  /** Credit available right now, for the stub relayer's checks. */
  creditAvailable(): Micros {
    return creditLine().available;
  },

  payNow(link: PaymentLink, txHash: Hex) {
    ledger.balance -= link.amount;
    ledger.activity.push(
      newTxItem({
        kind: "payment",
        title: link.merchant.name,
        detail: link.description,
        direction: "out",
        amount: link.amount,
        counterparty: { kind: "merchant", name: link.merchant.name },
        txHash,
      }),
    );
    changed();
  },

  openPlan(link: PaymentLink, txHash: Hex): Plan | null {
    const offer = link.modes.later;
    if (!offer) return null;
    const openedAt = Date.now();
    // PolarisCheckout.openPlan: the merchant is paid from the credit pool and
    // nothing leaves the buyer's account. Payment i is due (i + 1) intervals on.
    const plan: Plan = {
      id: `plan-${openedAt}`,
      loanId: ledger.nextLoanId++,
      merchant: link.merchant,
      description: link.description,
      principal: link.amount,
      interest: offer.interest,
      interval: offer.interval,
      instalments: offer.amounts.map((amount, index) => ({
        index,
        amount,
        dueAt: dueAt(openedAt, offer.interval, index),
        paidAt: null,
      })),
      status: "active",
      openedAt,
    };
    ledger.plans.unshift(plan);
    ledger.activity.push(
      newTxItem({
        kind: "plan-opened",
        title: link.merchant.name,
        detail: link.description,
        direction: "out",
        amount: link.amount,
        counterparty: { kind: "merchant", name: link.merchant.name },
        txHash,
        planId: plan.id,
      }),
    );
    changed();
    return plan;
  },

  subscribe(link: PaymentLink, txHash: Hex): Subscription | null {
    const offer = link.modes.subscription;
    if (!offer) return null;
    const now = Date.now();
    const sub: Subscription = {
      id: `sub-${now}`,
      subId: ledger.nextSubId++,
      merchant: link.merchant,
      name: offer.name,
      price: offer.price,
      periodSeconds: offer.periodSeconds,
      nextChargeAt: now + offer.periodSeconds * 1000,
      startedAt: now,
      status: "active",
    };
    ledger.subscriptions.unshift(sub);
    ledger.balance -= offer.price;
    ledger.activity.push(
      newTxItem({
        kind: "subscription",
        title: link.merchant.name,
        detail: offer.name,
        direction: "out",
        amount: offer.price,
        counterparty: { kind: "merchant", name: link.merchant.name },
        txHash,
      }),
    );
    changed();
    return sub;
  },

  cancelSubscription(subId: bigint) {
    const sub = ledger.subscriptions.find((s) => s.subId === subId);
    if (sub) sub.status = "cancelled";
    changed();
  },

  payEarly(planId: string, txHash: Hex) {
    const plan = ledger.plans.find((p) => p.id === planId);
    const next = plan?.instalments.find((i) => i.paidAt === null);
    if (!plan || !next) return;
    next.paidAt = Date.now();
    ledger.balance -= next.amount;
    if (plan.instalments.every((i) => i.paidAt !== null)) plan.status = "completed";
    ledger.activity.push(
      newTxItem({
        kind: "instalment",
        title: plan.merchant.name,
        detail: `Paid early · ${next.index + 1} of ${plan.instalments.length}`,
        direction: "out",
        amount: next.amount,
        counterparty: { kind: "merchant", name: plan.merchant.name },
        txHash,
        planId: plan.id,
      }),
    );
    changed();
  },

  send(linkKey: Address, amount: Micros, senderName: string, expiresAt: number, txHash: Hex) {
    ledger.balance -= amount;
    ledger.sendLinks.set(getAddress(linkKey), {
      linkKey: getAddress(linkKey),
      amount,
      senderName,
      status: "open",
      expiresAt,
      settledAt: null,
    });
    const entry = newTxItem({
      kind: "sent-link",
      title: "Send link",
      detail: "Waiting to be claimed",
      direction: "out",
      amount,
      counterparty: { kind: "polaris", name: "Send link" },
      txHash,
      linkKey: getAddress(linkKey),
    });
    ledger.activity.push(entry);
    sendActivity.set(getAddress(linkKey), entry.id);
    changed();
  },

  cancelSend(linkKey: Address, txHash: Hex) {
    const link = ledger.sendLinks.get(getAddress(linkKey));
    if (!link || link.status !== "open" || link.amount === null) return;
    link.status = "cancelled";
    link.settledAt = Date.now();
    ledger.balance += link.amount;
    const sent = ledger.activity.find((a) => a.id === sendActivity.get(getAddress(linkKey)));
    if (sent) sent.detail = "Cancelled";
    ledger.activity.push(
      newTxItem({
        kind: "refund",
        title: "Link cancelled",
        detail: "Back in your account",
        direction: "in",
        amount: link.amount,
        counterparty: { kind: "polaris", name: "Link cancelled" },
        txHash,
      }),
    );
    changed();
  },

  claim(linkKey: Address, amount: Micros, senderName: string, txHash: Hex) {
    const key = getAddress(linkKey);
    const link = ledger.sendLinks.get(key);
    if (link) {
      link.status = "claimed";
      link.settledAt = Date.now();
      const sent = ledger.activity.find((a) => a.id === sendActivity.get(key));
      if (sent) sent.detail = "Claimed";
    } else {
      ledger.sendLinks.set(key, {
        linkKey: key,
        amount,
        senderName,
        status: "claimed",
        expiresAt: null,
        settledAt: Date.now(),
      });
    }
    ledger.balance += amount;
    ledger.activity.push(
      newTxItem({
        kind: "claimed",
        title: senderName,
        detail: "Link claimed",
        direction: "in",
        amount,
        counterparty: { kind: "person", name: senderName },
        txHash,
      }),
    );
    changed();
  },

  transfer(to: Person, amount: Micros, txHash: Hex) {
    ledger.balance -= amount;
    ledger.activity.push(
      newTxItem({
        kind: "sent",
        title: to.name,
        detail: "Sent",
        direction: "out",
        amount,
        counterparty: { kind: "person", name: to.name, country: to.country },
        txHash,
      }),
    );
    changed();
  },

  /** Bring your history: the underwriter scored an outside wallet (§5.5). */
  linkHistory() {
    ledger.historyLinked = true;
    changed();
  },

  /** Back to the seeded state (tests, "Reset demo"). */
  reset() {
    ledger = seed();
    changed();
  },
};
