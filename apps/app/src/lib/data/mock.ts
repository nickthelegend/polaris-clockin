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
  // Everyday places: the small payments that move a balance every few hours.
  frischmarkt: {
    id: "frischmarkt",
    name: "Frischmarkt",
    address: fakeAddress("merchant:frischmarkt"),
    city: "Berlin",
    country: "DE",
    category: "Groceries",
  },
  rota: {
    id: "rota",
    name: "Rota",
    address: fakeAddress("merchant:rota"),
    city: "Berlin",
    country: "DE",
    category: "Rides",
  },
  kiez: {
    id: "kiez-kitchen",
    name: "Kiez Kitchen",
    address: fakeAddress("merchant:kiez-kitchen"),
    city: "Berlin",
    country: "DE",
    category: "Restaurant",
  },
  kapitel: {
    id: "kapitel-books",
    name: "Kapitel Books",
    address: fakeAddress("merchant:kapitel-books"),
    city: "Berlin",
    country: "DE",
    category: "Books",
  },
  welle: {
    id: "welle-mobile",
    name: "Welle Mobile",
    address: fakeAddress("merchant:welle-mobile"),
    city: "Berlin",
    country: "DE",
    category: "Phone plan",
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
  // Opened about 15, 9 and 40 days ago; each paid instalment was paid on its
  // due day, so Lumen's second one went out 20 hours ago.
  const lumen = planFrom("plan-lumen", 41n, merchants.lumen, "Studio headphones", dollars(240), t - 14 * MS_DAY - 20 * MS_HOUR, 2);
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

  const m = (merchant: Merchant) => ({ kind: "merchant" as const, name: merchant.name, category: merchant.category });
  const p = (person: Person) => ({ kind: "person" as const, name: person.name, country: person.country });
  const [marisol, jonas, ana, tomas, aisha] = people as [Person, Person, Person, Person, Person];
  const bank = { kind: "polaris" as const, name: "Added money" };
  const ago = (days: number, hours = 0, minutes = 0) => t - days * MS_DAY - hours * MS_HOUR - minutes * 60_000;
  /** Instalment `i` of a plan, paid on its due day. */
  const paid = (id: string, plan: Plan, i: number, label: string) =>
    item(id, "instalment", m(plan.merchant), `${label} · ${i + 1} of 4`, "out", plan.instalments[i]!.amount, plan.instalments[i]!.dueAt, plan.id);
  const { frischmarkt, rota, kiez, kapitel, welle, nomada } = merchants;

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
    // A month of an ordinary life: coffee, rides, groceries, a refund, friends
    // paying back, instalments. The balance moves every few hours.
    activity: [
      // The last 24 hours.
      item("a-coffee", "payment", m(nomada), "Oat flat white", "out", dollars(4.6), ago(0, 0, 25)),
      item("a-ride", "payment", m(rota), "Ride to Kreuzberg", "out", dollars(12.4), ago(0, 2, 10)),
      item("a-tomas", "received", p(tomas), "Concert tickets, his half", "in", dollars(38), ago(0, 4, 35)),
      item("a-lunch", "payment", m(kiez), "Lunch bowl", "out", dollars(14.2), ago(0, 6, 50)),
      item("a-return", "refund", m(merchants.lumen), "Cable returned", "in", dollars(19.99), ago(0, 9, 40)),
      item("a-groceries", "payment", m(frischmarkt), "Weekly groceries", "out", dollars(38.75), ago(0, 13, 20)),
      paid("a-lumen-2", lumen, 1, "Studio headphones"),
      item("a-cortado", "payment", m(nomada), "Cortado", "out", dollars(3.9), ago(0, 22, 30)),
      // The week.
      item("a-marisol", "sent-link", p(marisol), "Sent by link", "out", dollars(50), ago(1, 6)),
      item("a-ride-2", "payment", m(rota), "Ride home", "out", dollars(9.8), ago(1, 9)),
      paid("a-kora-1", kora, 0, "Rail pass"),
      item("a-dinner", "payment", m(kiez), "Dinner for two", "out", dollars(46.3), ago(2, 20)),
      item("a-added-3", "added", bank, "From your bank", "in", dollars(200), ago(3, 6)),
      item("a-books", "payment", m(kapitel), "Two paperbacks", "out", dollars(27.5), ago(3, 14)),
      item("a-nomada", "payment", m(nomada), "Flat white and a croissant", "out", dollars(7.8), ago(4, 5)),
      item("a-groceries-2", "payment", m(frischmarkt), "Groceries", "out", dollars(52.1), ago(4, 22)),
      item("a-ride-3", "payment", m(rota), "Airport ride", "out", dollars(31.6), ago(5, 8)),
      item("a-lunch-4", "payment", m(kiez), "Lunch", "out", dollars(13.1), ago(5, 21)),
      item("a-jonas", "received", p(jonas), "Flat share", "in", dollars(320), ago(6, 2)),
      item("a-ride-6", "payment", m(rota), "Ride to Mitte", "out", dollars(10.4), ago(6, 13)),
      item("a-coffee-2", "payment", m(nomada), "Flat white", "out", dollars(4.6), ago(6, 19)),
      // The week before.
      paid("a-lumen-1", lumen, 0, "Studio headphones"),
      item("a-lunch-2", "payment", m(kiez), "Lunch", "out", dollars(13.8), ago(8, 5)),
      item("a-kora-0", "plan-opened", m(merchants.kora), "Lisbon to Porto rail pass", "out", kora.principal, kora.openedAt, kora.id),
      item("a-kinetik", "subscription", m(merchants.kinetik), "Monthly membership", "out", dollars(29), ago(9, 4)),
      item("a-groceries-3", "payment", m(frischmarkt), "Groceries", "out", dollars(44.95), ago(10, 21)),
      item("a-phone", "payment", m(welle), "Phone plan", "out", dollars(15), ago(11, 6)),
      item("a-ana", "claimed", p(ana), "Link claimed", "in", dollars(75), ago(12, 7)),
      paid("a-nomada-4", grinder, 3, "Espresso grinder"),
      item("a-ride-4", "payment", m(rota), "Ride to the station", "out", dollars(11.2), ago(13, 2)),
      // Earlier in the month.
      item("a-lumen-0", "plan-opened", m(merchants.lumen), "Studio headphones", "out", lumen.principal, lumen.openedAt, lumen.id),
      item("a-coffee-3", "payment", m(nomada), "Flat white", "out", dollars(4.6), ago(15, 3)),
      item("a-aisha", "received", p(aisha), "Dinner split", "in", dollars(60), ago(16, 9)),
      item("a-groceries-4", "payment", m(frischmarkt), "Groceries", "out", dollars(61.4), ago(17, 20)),
      item("a-figura", "subscription", m(merchants.figura), "Figura Pro", "out", dollars(12), ago(18)),
      paid("a-nomada-3", grinder, 2, "Espresso grinder"),
      item("a-tomas-2", "sent", p(tomas), "Pizza night", "out", dollars(25), ago(20, 4)),
      item("a-added", "added", bank, "From your bank", "in", dollars(500), ago(21)),
      item("a-lunch-3", "payment", m(kiez), "Lunch", "out", dollars(12.9), ago(22, 6)),
      item("a-books-2", "payment", m(kapitel), "A notebook and pens", "out", dollars(18), ago(24, 3)),
      item("a-ride-5", "payment", m(rota), "Ride to Neukölln", "out", dollars(14.7), ago(25, 11)),
      paid("a-nomada-2", grinder, 1, "Espresso grinder"),
      item("a-groceries-5", "payment", m(frischmarkt), "Groceries", "out", dollars(48.2), ago(27, 8)),
      item("a-added-2", "added", bank, "From your bank", "in", dollars(250), ago(28, 15)),
      // Before that.
      paid("a-nomada-1", grinder, 0, "Espresso grinder"),
      item("a-kinetik-1", "subscription", m(merchants.kinetik), "Monthly membership", "out", dollars(29), ago(39, 4)),
      item("a-nomada-0", "plan-opened", m(nomada), "Espresso grinder", "out", grinder.principal, grinder.openedAt, grinder.id),
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
        counterparty: { kind: "merchant", name: link.merchant.name, category: link.merchant.category },
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
        counterparty: { kind: "merchant", name: link.merchant.name, category: link.merchant.category },
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
        counterparty: { kind: "merchant", name: link.merchant.name, category: link.merchant.category },
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
        counterparty: { kind: "merchant", name: plan.merchant.name, category: plan.merchant.category },
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
      title: "Link for anyone",
      detail: "Waiting to be claimed",
      direction: "out",
      amount,
      counterparty: { kind: "polaris", name: "Link for anyone" },
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
