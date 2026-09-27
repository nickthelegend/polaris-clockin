import { payInFourQuote, PLAN_INSTALLMENTS, PLAN_INTERVAL_DAYS, isToday } from "./format";
import { linkUrl } from "./links";
import { DataError, type DashboardData } from "./source";
import type {
  Address,
  ApiKey,
  AutoPayouts,
  Cents,
  CollectorStatus,
  Merchant,
  Overview,
  PayMode,
  Payment,
  PaymentLink,
  Payout,
  Plan,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

/**
 * Sample data, generated in the browser. Two uses, both labelled "Sample"
 * wherever they show:
 *
 * - "Preview with sample data": a signed-in merchant with an empty book can
 *   see what the dashboard looks like full. Only the money views read it
 *   (overview, payments, plans, payouts); links, keys and webhooks stay theirs.
 * - The development-only mock session (POLARIS_DEV_MOCK_SESSION), which has no
 *   server session at all, so it serves every read and write from memory.
 *
 * It is deterministic for a merchant and a day, internally consistent (every
 * Pay in 4 payment has a plan, the balance is what came in since the last
 * payout), and spans 120 days so the 3-month candles have history.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MERCHANT_FEE_BPS = 50;

type Rng = ReturnType<typeof rng>;

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
  const hex = (bytes: number) => Array.from({ length: bytes }, () => int(0, 255).toString(16).padStart(2, "0")).join("");
  const id = (length: number) =>
    Array.from({ length }, () => pick("23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".split(""))).join("");
  return { next, int, pick, hex, id };
}

/** A design studio's catalogue: the plan's demo merchant. */
const CATALOGUE: { description: string; cents: Cents; modes: PayMode[]; weight: number }[] = [
  { description: "Brand identity package", cents: 200_00, modes: ["now", "later"], weight: 5 },
  { description: "Logo refresh", cents: 480_00, modes: ["now", "later"], weight: 2 },
  { description: "Website audit", cents: 150_00, modes: ["now"], weight: 3 },
  { description: "Monthly design retainer", cents: 900_00, modes: ["subscribe"], weight: 1 },
  { description: "Type licence, 3 seats", cents: 96_00, modes: ["now"], weight: 4 },
  { description: "Packaging mockups", cents: 320_00, modes: ["now", "later"], weight: 2 },
  { description: "Workshop seat", cents: 75_00, modes: ["now"], weight: 5 },
  { description: "Pitch deck design", cents: 640_00, modes: ["now", "later"], weight: 1 },
  { description: "Illustration set", cents: 260_00, modes: ["now", "later"], weight: 2 },
  { description: "Social kit, monthly", cents: 120_00, modes: ["subscribe"], weight: 3 },
  { description: "Icon pack", cents: 48_00, modes: ["now"], weight: 4 },
];

const WEIGHTED = CATALOGUE.flatMap((item, i) => Array.from({ length: item.weight }, () => i));

export type SampleBook = {
  merchant: Merchant;
  links: PaymentLink[];
  payments: Payment[];
  plans: Plan[];
  payouts: Payout[];
  balanceCents: Cents;
  collector: CollectorStatus;
  auto: AutoPayouts;
  apiKeys: ApiKey[];
  webhooks: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
};

/** The mock session's merchant. Invented, like every sample merchant. */
export const SAMPLE_MERCHANT: Merchant = {
  id: "did:privy:dev-mock-session",
  businessName: "Oat & Ember",
  walletAddress: "0x7A3f5C21d0b4E8a96F1c2B3D4e5F60718293A1c2",
  email: "ana@oatandember.studio",
  createdAt: "2026-05-02T10:00:00.000Z",
};

function address(r: Rng): Address {
  return `0x${r.hex(20)}`;
}

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function createSampleBook(merchant: Merchant, now = Date.now()): SampleBook {
  // Seeded per merchant and per day: stable across reloads, fresh tomorrow.
  const r = rng(hashSeed(`${merchant.id}:${Math.floor(now / DAY)}`));
  const today = startOfDay(now);

  /* Links: one per catalogue line. */
  const links: PaymentLink[] = CATALOGUE.map((item, i) => {
    const id = r.id(10);
    return {
      id,
      url: linkUrl(id),
      amountCents: item.cents,
      description: item.description,
      modes: item.modes,
      usage: i === 7 ? "single" : "reusable",
      expiresAt: i === 6 ? new Date(now + 21 * DAY).toISOString() : null,
      status: "active",
      paymentsCount: 0,
      collectedCents: 0,
      createdAt: new Date(now - (130 - i * 2) * DAY).toISOString(),
    };
  });

  /* A pool of returning buyers. */
  const buyers = Array.from({ length: 140 }, () => address(r));

  /* Payments over 120 days: a rising trend, quieter weekends, today so far. */
  const times: number[] = [];
  for (let d = 120; d >= 1; d--) {
    const dayStart = today - d * DAY;
    const dow = new Date(dayStart).getDay();
    const weekend = dow === 0 || dow === 6;
    const base = 3 + (120 - d) / 26 + (weekend ? -1.6 : 0.8);
    const count = Math.max(1, Math.round(base + (r.next() - 0.5) * 4));
    for (let k = 0; k < count; k++) times.push(dayStart + r.int(8, 21) * HOUR + r.int(0, 59) * 60_000);
  }
  const hoursToday = Math.max(1, Math.floor((now - today) / HOUR));
  const todayCount = Math.min(7, Math.max(2, Math.round(hoursToday / 2.5)));
  for (let k = 0; k < todayCount; k++) {
    times.push(today + Math.floor(((k + r.next()) / todayCount) * Math.max(60_000, now - today - 90_000)));
  }
  times.sort((a, b) => a - b);

  const payments: Payment[] = [];
  const plans: Plan[] = [];
  let order = 4001;
  for (const t of times) {
    const index = r.pick(WEIGHTED);
    const item = CATALOGUE[index]!;
    const link = links[index]!;
    if (link.usage === "single" && link.paymentsCount > 0) continue;
    const mode: PayMode = item.modes.includes("subscribe") ? "subscribe" : item.modes.includes("later") && r.next() < 0.38 ? "later" : "now";
    const failed = mode !== "later" && r.next() < 0.035;
    const fee = mode === "later" ? 0 : Math.round((item.cents * MERCHANT_FEE_BPS) / 10_000);
    const buyer = r.next() < 0.35 ? r.pick(buyers.slice(0, 30)) : r.pick(buyers);
    const orderId = `ord_${order++}`;
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
      createdAt: new Date(t).toISOString(),
    });
    if (failed) continue;
    link.paymentsCount += 1;
    link.collectedCents += item.cents;
    if (link.usage === "single") link.status = "used";
    if (mode === "later") plans.push(planFor(r, orderId, item.description, buyer, item.cents, t, now));
  }
  payments.reverse();
  plans.sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  /* Payouts: every Friday at 17:00 for twelve weeks, of what came in since the last. */
  const payouts: Payout[] = [];
  const destination = address(r);
  const fridays: number[] = [];
  for (let d = 84; d >= 1; d--) {
    const t = today - d * DAY;
    if (new Date(t).getDay() === 5) fridays.push(t + 17 * HOUR);
  }
  let from = today - 121 * DAY;
  for (const t of fridays) {
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

  const createdKey = new Date(now - 18 * DAY).toISOString();
  return {
    merchant,
    links: links.reverse(),
    payments,
    plans,
    payouts,
    balanceCents,
    collector: { state: "running", lastPassAt: new Date(now - r.int(8, 50) * 1000).toISOString(), runner: "cre" },
    auto: { enabled: false, payoutAddress: destination, policyId: null, hourUtc: 17, nextRunAt: null },
    apiKeys: [
      {
        id: "key_sample01",
        name: "Production server",
        publishableKey: "pk_test_5e8TqWmK2vN7xR4pL9sB3dYh",
        secretHint: "sk_test_…a1b2",
        createdAt: createdKey,
        lastUsedAt: null,
      },
    ],
    webhooks: [
      {
        id: "we_sample01",
        url: "https://hooks.oatandember.studio/polaris",
        events: ["payment.succeeded", "plan.opened", "installment.collected", "payout.paid"],
        secretHint: "whsec_…9f3c",
        enabled: true,
        createdAt: createdKey,
      },
    ],
    deliveries: [],
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

function planFor(r: Rng, orderId: string, description: string, buyer: Address, principal: Cents, openedAt: number, now: number): Plan {
  const quote = payInFourQuote(principal);
  const interval = PLAN_INTERVAL_DAYS * DAY;
  const due = Math.min(PLAN_INSTALLMENTS, Math.floor((now - openedAt) / interval));
  const dunning = due > 0 && due < PLAN_INSTALLMENTS && r.next() < 0.14;
  const writtenOff = !dunning && due >= PLAN_INSTALLMENTS && r.next() < 0.02;
  const paid = writtenOff ? 2 : dunning ? due - 1 : due;
  const repaid = !writtenOff && paid >= PLAN_INSTALLMENTS;
  const outstanding = repaid ? 0 : paid === 0 ? quote.total : quote.total - quote.each * paid;
  return {
    id: `plan_${r.id(12)}`,
    orderId,
    description,
    buyer,
    principalCents: principal,
    totalCents: quote.total,
    outstandingCents: outstanding,
    installmentCount: PLAN_INSTALLMENTS,
    installmentsPaid: Math.min(paid, PLAN_INSTALLMENTS),
    state: writtenOff ? "written_off" : repaid ? "repaid" : dunning ? "dunning" : "collecting",
    attempts: dunning ? r.int(1, 3) : writtenOff ? 5 : 0,
    nextDueAt: repaid || writtenOff ? null : new Date(openedAt + (paid + 1) * interval).toISOString(),
    openedAt: new Date(openedAt).toISOString(),
  };
}

/** The overview the server would compute from this book. */
export function sampleOverview(book: SampleBook, now = Date.now()): Overview {
  const today = book.payments.filter((p) => isToday(p.createdAt, now));
  const succeeded = today.filter((p) => p.status === "succeeded");
  let collectingCents = 0;
  let collectingPlans = 0;
  let atRiskCents = 0;
  let atRiskPlans = 0;
  let collectedThisWeekCents = 0;
  let cameDue = 0;
  let collected = 0;
  const WEEK = 7 * DAY;
  for (const plan of book.plans) {
    if (plan.state === "collecting") {
      collectingCents += plan.outstandingCents;
      collectingPlans += 1;
    } else if (plan.state === "dunning") {
      atRiskCents += plan.outstandingCents;
      atRiskPlans += 1;
    }
    const each = Math.floor(plan.totalCents / plan.installmentCount);
    const opened = new Date(plan.openedAt).getTime();
    for (let k = 1; k <= plan.installmentsPaid; k++) {
      const dueAt = opened + k * WEEK;
      if (dueAt <= now && dueAt > now - WEEK) collectedThisWeekCents += each;
    }
    const due = Math.min(plan.installmentCount, Math.floor((now - opened) / WEEK));
    cameDue += due;
    collected += Math.min(plan.installmentsPaid, due);
  }
  return {
    merchant: book.merchant,
    balanceCents: book.balanceCents,
    today: { count: succeeded.length, grossCents: succeeded.reduce((s, p) => s + p.amountCents, 0), payments: today.slice(0, 6) },
    exposure: {
      outstandingCents: collectingCents + atRiskCents,
      collectingCents,
      collectingPlans,
      atRiskCents,
      atRiskPlans,
      collectedThisWeekCents,
      collectionRate: cameDue === 0 ? null : Math.round((collected / cameDue) * 1000) / 10,
    },
    collector: book.collector,
    autoPayouts: book.auto,
    sample: true,
  };
}

const clone = <T,>(v: T): T => structuredClone(v);
const wait = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

function sampleId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12)}`;
}

/**
 * The whole DashboardData over one in-memory sample book. Writes change the
 * book for this page load only. Money never moves: withdrawals and automatic
 * payouts refuse, as they do everywhere until the payout rails are live.
 */
/** A merchant who has just signed up: nothing paid, nothing connected. */
export function createEmptyBook(merchant: Merchant): SampleBook {
  return {
    merchant: clone(merchant),
    links: [],
    payments: [],
    plans: [],
    payouts: [],
    balanceCents: 0,
    collector: { state: "stopped", lastPassAt: null, runner: "cre" },
    auto: { enabled: false, payoutAddress: null, policyId: null, hourUtc: 17, nextRunAt: null },
    apiKeys: [],
    webhooks: [],
    deliveries: [],
  };
}

export function createSampleData(merchant: Merchant = SAMPLE_MERCHANT, { empty = false } = {}): DashboardData {
  let book: SampleBook | null = null;
  const get = () => (book ??= empty ? createEmptyBook(merchant) : createSampleBook(merchant));

  return {
    getMerchant: async () => {
      await wait(120);
      return clone(get().merchant);
    },
    updateMerchant: async (input) => {
      await wait();
      get().merchant.businessName = input.businessName;
      return clone(get().merchant);
    },
    getOverview: async () => {
      await wait();
      return clone(sampleOverview(get()));
    },
    listLinks: async () => {
      await wait();
      return clone(get().links);
    },
    createLink: async (input) => {
      await wait();
      const id = sampleId("lnk").slice(4, 14);
      const link: PaymentLink = {
        id,
        url: linkUrl(id),
        amountCents: input.amountCents,
        description: input.description,
        modes: input.modes,
        usage: input.usage,
        expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * HOUR).toISOString() : null,
        status: "active",
        paymentsCount: 0,
        collectedCents: 0,
        createdAt: new Date().toISOString(),
      };
      get().links.unshift(link);
      return clone(link);
    },
    deactivateLink: async (linkId) => {
      await wait();
      const link = get().links.find((l) => l.id === linkId);
      if (!link) throw new DataError("That link doesn't exist.", 404, "not_found");
      link.status = "inactive";
      return clone(link);
    },
    listPayments: async () => {
      await wait();
      return clone(get().payments);
    },
    listPlans: async () => {
      await wait();
      return clone(get().plans);
    },
    getPayouts: async () => {
      await wait();
      const b = get();
      return clone({ balanceCents: b.balanceCents, walletAddress: b.merchant.walletAddress, auto: b.auto, history: b.payouts });
    },
    withdraw: async () => {
      await wait();
      throw new DataError("Sample data can't be withdrawn. Turn sample data off to use your real balance.", 409, "sample_data");
    },
    setAutoPayouts: async () => {
      await wait();
      throw new DataError("Sample data can't change payout settings. Turn sample data off first.", 409, "sample_data");
    },
    listApiKeys: async () => {
      await wait();
      return clone(get().apiKeys);
    },
    createApiKey: async () => {
      await wait();
      throw new DataError("Keys arrive with the checkout API.", 409, "not_available");
    },
    revokeApiKey: async (keyId) => {
      await wait();
      const b = get();
      if (!b.apiKeys.some((k) => k.id === keyId)) throw new DataError("That key doesn't exist.", 404, "not_found");
      b.apiKeys = b.apiKeys.filter((k) => k.id !== keyId);
      return { id: keyId, revoked: true };
    },
    listWebhooks: async () => {
      await wait();
      return clone({ endpoints: get().webhooks, deliveries: get().deliveries });
    },
    createWebhook: async (input) => {
      await wait();
      const b = get();
      if (b.webhooks.some((w) => w.url === input.url)) throw new DataError("That endpoint is already registered.", 409, "duplicate", "url");
      const endpoint: WebhookEndpoint = {
        id: sampleId("we"),
        url: input.url,
        events: input.events,
        secretHint: "whsec_…d41e",
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      b.webhooks.push(endpoint);
      return { endpoint: clone(endpoint), secret: "whsec_sample_not_a_real_secret_d41e" };
    },
    updateWebhook: async (endpointId, input) => {
      await wait();
      const endpoint = get().webhooks.find((w) => w.id === endpointId);
      if (!endpoint) throw new DataError("That endpoint doesn't exist.", 404, "not_found");
      Object.assign(endpoint, input);
      return clone(endpoint);
    },
    deleteWebhook: async (endpointId) => {
      await wait();
      const b = get();
      b.webhooks = b.webhooks.filter((w) => w.id !== endpointId);
      return { id: endpointId, deleted: true };
    },
    sendTestEvent: async (endpointId) => {
      await wait(420);
      const b = get();
      const endpoint = b.webhooks.find((w) => w.id === endpointId);
      if (!endpoint) throw new DataError("That endpoint doesn't exist.", 404, "not_found");
      const eventId = sampleId("evt");
      const body = JSON.stringify({
        eventId,
        event: "payment.succeeded",
        createdAt: new Date().toISOString(),
        merchantId: b.merchant.id,
        livemode: false,
        test: true,
        data: { orderId: "ord_test_sample", amount: "200.00", currency: "USD", mode: "now", description: "Test event from the Polaris dashboard" },
      });
      const delivery: WebhookDelivery = {
        id: sampleId("del"),
        endpointId,
        url: endpoint.url,
        event: "payment.succeeded",
        eventId,
        status: null,
        durationMs: null,
        attempt: 1,
        test: true,
        simulated: true,
        request: {
          headers: {
            "content-type": "application/json",
            "polaris-signature": `t=${Math.floor(Date.now() / 1000)},v1=sample`,
            "polaris-event": "payment.succeeded",
            "polaris-delivery-attempt": "1",
          },
          body,
        },
        createdAt: new Date().toISOString(),
      };
      b.deliveries.unshift(delivery);
      return clone(delivery);
    },
  };
}

/**
 * The preview for a real merchant: sample money views over their own live
 * links, keys and webhooks.
 */
export function withSampleMoney(live: DashboardData, merchant: Merchant): DashboardData {
  const sample = createSampleData(merchant);
  return {
    ...live,
    getOverview: sample.getOverview,
    listPayments: sample.listPayments,
    listPlans: sample.listPlans,
    getPayouts: sample.getPayouts,
    withdraw: sample.withdraw,
    setAutoPayouts: sample.setAutoPayouts,
  };
}
