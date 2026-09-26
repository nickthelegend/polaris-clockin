import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { recoverTypedDataAddress, type Hex } from "viem";

import { DEV_MOCK_MERCHANT, DEV_MOCK_PATH, DEV_MOCK_PUBLISHABLE_KEY, DEV_MOCK_SECRET_KEY, DEV_MOCK_WEBHOOK_SECRET, payInFourApr } from "@/lib/polaris";
import { MONAD_TESTNET, RECEIVE_WITH_AUTHORIZATION_TYPES, ZERO_ADDRESS, paymentIdFor } from "@/lib/polaris-sdk/browser";
import { formatCents, quotePayIn4, toCents } from "@/lib/polaris-sdk/money";
import type {
  Address,
  CheckoutMode,
  CheckoutSession,
  CheckoutSessionCreateParams,
  PolarisEvent,
  PolarisEventDataMap,
  PolarisEventType,
} from "@/lib/polaris-sdk/types";
import { generateTestHeader } from "@/lib/polaris-sdk/webhooks";

/**
 * A development stand-in for the Polaris API, implementing the same HTTP
 * contract as the real one (POST/GET /api/v1/checkout/sessions), a test
 * checkout page, a relayer for direct wallet payments, and signed webhook
 * delivery back to the store. State lives in .data/dev-polaris.json.
 *
 * It is labelled as a mock everywhere it shows up, and it moves no money.
 */

export const MOCK_DOMAIN = { name: "AUSD", version: "1" } as const;
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface MockDelivery {
  eventId: string;
  type: PolarisEventType;
  status: number | null;
  attempts: number;
  at: string;
}

export interface MockSession extends CheckoutSession {
  amount: string;
  modes: CheckoutMode[];
  successUrl: string;
  webhookUrl: string;
  deliveries: MockDelivery[];
  plan?: { planId: string; collected: number; total: number; schedule: { index: number; amount: string; dueAt: string }[] };
  subscriptionId?: string;
  periodsCharged?: number;
  payer?: Address;
}

interface MockState {
  sessions: Record<string, MockSession>;
  idempotency: Record<string, { fingerprint: string; sessionId: string }>;
  payments: Record<string, { orderId: string; txHash: Hex; at: string }>;
}

export interface MockKeys {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  merchant: Address;
}

export function mockKeys(env: Record<string, string | undefined> = process.env): MockKeys {
  return {
    secretKey: env.POLARIS_SECRET_KEY?.trim() || DEV_MOCK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY?.trim() || DEV_MOCK_PUBLISHABLE_KEY,
    webhookSecret: env.POLARIS_WEBHOOK_SECRET?.trim() || DEV_MOCK_WEBHOOK_SECRET,
    merchant: (env.POLARIS_MERCHANT_ADDRESS?.trim() as Address) || DEV_MOCK_MERCHANT,
  };
}

/* ── State ─────────────────────────────────────────────────────────────── */

const holder = globalThis as unknown as { __polarisDevMock?: MockState };
const stateFile = () => path.join(process.env.SHOP_DATA_DIR ?? path.join(process.cwd(), ".data"), "dev-polaris.json");

function state(): MockState {
  if (!holder.__polarisDevMock) {
    let loaded: MockState = { sessions: {}, idempotency: {}, payments: {} };
    if (process.env.SHOP_ORDER_STORE !== "memory") {
      try {
        loaded = { ...loaded, ...(JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<MockState>) };
      } catch {
        // First run.
      }
    }
    holder.__polarisDevMock = loaded;
  }
  return holder.__polarisDevMock;
}

function save() {
  if (process.env.SHOP_ORDER_STORE === "memory") return;
  try {
    const file = stateFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(state(), null, 2));
    renameSync(`${file}.tmp`, file);
  } catch {
    // The mock keeps working from memory.
  }
}

export function resetMockState() {
  holder.__polarisDevMock = { sessions: {}, idempotency: {}, payments: {} };
}

/* ── HTTP helpers ──────────────────────────────────────────────────────── */

export function apiError(status: number, type: string, code: string, message: string, param?: string): Response {
  return Response.json(
    { error: { type, code, message, ...(param ? { param } : {}) } },
    { status, headers: { "polaris-request-id": `req_mock_${randomBytes(6).toString("hex")}` } },
  );
}

export function checkSecretKey(req: Request, keys: MockKeys = mockKeys()): Response | null {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key) return apiError(401, "authentication_error", "missing_api_key", "No API key. Send Authorization: Bearer sk_test_….");
  if (key.startsWith("pk_")) return apiError(401, "authentication_error", "publishable_key", "That's a publishable key. Checkout sessions need the secret key.");
  if (key !== keys.secretKey) return apiError(401, "authentication_error", "invalid_api_key", "That API key isn't valid.");
  return null;
}

/* ── Sessions ──────────────────────────────────────────────────────────── */

type CreateResult = { status: number; body: unknown; replayed?: boolean };

export function createSession(input: unknown, idempotencyKey: string | null, origin: string, now: Date = new Date()): CreateResult {
  const params = validateCreate(input);
  if ("error" in params) return { status: 400, body: { error: params.error } };

  const print = createHash("sha256").update(JSON.stringify(params.value)).digest("hex");
  const s = state();
  if (idempotencyKey) {
    const prior = s.idempotency[idempotencyKey];
    if (prior) {
      if (prior.fingerprint !== print) {
        return {
          status: 409,
          body: {
            error: {
              type: "idempotency_error",
              code: "idempotency_key_reused",
              message: "This idempotency key was already used with different parameters.",
            },
          },
        };
      }
      const existing = s.sessions[prior.sessionId];
      if (existing) return { status: 200, body: publicSession(existing, now), replayed: true };
    }
  }

  const id = `cs_test_${randomBytes(12).toString("hex")}`;
  const session: MockSession = {
    id,
    object: "checkout.session",
    url: `${origin}${DEV_MOCK_PATH}/checkout/${id}`,
    status: "open",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    amount: params.value.amount,
    currency: "USD",
    description: params.value.description,
    lineItems: params.value.lineItems ?? [],
    modes: params.value.modes,
    metadata: params.value.metadata ?? {},
    mode: null,
    successUrl: params.value.successUrl,
    cancelUrl: params.value.cancelUrl ?? null,
    subscription: params.value.subscription ?? null,
    livemode: false,
    webhookUrl: `${origin}/api/webhooks/polaris`,
    deliveries: [],
  };
  s.sessions[id] = session;
  if (idempotencyKey) s.idempotency[idempotencyKey] = { fingerprint: print, sessionId: id };
  save();
  return { status: 200, body: publicSession(session, now) };
}

export function getSession(id: string, now: Date = new Date()): MockSession | null {
  const session = state().sessions[id];
  if (!session) return null;
  if (session.status === "open" && new Date(session.expiresAt).getTime() < now.getTime()) {
    session.status = "expired";
    save();
  }
  return session;
}

export function publicSession(session: MockSession, now: Date = new Date()): CheckoutSession {
  const current = getSession(session.id, now) ?? session;
  // Internal bookkeeping (webhook URL, deliveries, plan) stays inside the mock.
  return {
    id: current.id,
    object: "checkout.session",
    url: current.url,
    status: current.status,
    expiresAt: current.expiresAt,
    createdAt: current.createdAt,
    amount: current.amount,
    currency: current.currency,
    description: current.description,
    modes: current.modes,
    lineItems: current.lineItems,
    metadata: current.metadata,
    mode: current.mode ?? null,
    successUrl: current.successUrl,
    cancelUrl: current.cancelUrl ?? null,
    subscription: current.subscription ?? null,
    livemode: false,
  };
}

function validateCreate(input: unknown): { value: CheckoutSessionCreateParams } | { error: { type: string; code: string; message: string; param?: string } } {
  const bad = (code: string, message: string, param?: string) => ({ error: { type: "invalid_request_error", code, message, param } });
  if (typeof input !== "object" || input === null) return bad("invalid_body", "The body must be a JSON object.");
  const body = input as Record<string, unknown>;

  let amountCents: bigint;
  try {
    amountCents = toCents(body.amount as string);
  } catch {
    return bad("invalid_amount", 'amount must be a positive dollar amount like "200.00".', "amount");
  }
  if (body.currency !== "USD") return bad("invalid_currency", 'currency must be "USD".', "currency");
  if (typeof body.description !== "string" || !body.description.trim()) return bad("missing_description", "description is required.", "description");
  const modes = body.modes;
  if (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => m === "now" || m === "later" || m === "subscribe")) {
    return bad("invalid_modes", 'modes must be a non-empty list of "now", "later" and "subscribe".', "modes");
  }
  if (new Set(modes).size !== modes.length) return bad("invalid_modes", "modes has a repeat.", "modes");
  for (const field of ["successUrl", "cancelUrl"] as const) {
    const value = body[field];
    if (value === undefined && field === "cancelUrl") continue;
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return bad("invalid_url", `${field} must be an absolute http(s) URL.`, field);
    }
  }
  let lineItems = body.lineItems as CheckoutSessionCreateParams["lineItems"];
  if (lineItems !== undefined) {
    if (!Array.isArray(lineItems)) return bad("invalid_line_items", "lineItems must be a list.", "lineItems");
    let sum = 0n;
    for (const item of lineItems) {
      if (!item || typeof item.name !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1) {
        return bad("invalid_line_items", "Every line item needs a name and a whole quantity.", "lineItems");
      }
      try {
        sum += toCents(item.unitAmount) * BigInt(item.quantity);
      } catch {
        return bad("invalid_line_items", "Every line item needs a unitAmount like \"12.00\".", "lineItems");
      }
    }
    if (sum !== amountCents) {
      return bad("line_items_mismatch", `lineItems add up to ${formatCents(sum)}, not ${formatCents(amountCents)}.`, "lineItems");
    }
    lineItems = lineItems.map((item) => ({ ...item, unitAmount: formatCents(toCents(item.unitAmount)) }));
  }
  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || metadata === null || Object.keys(metadata).length > 20 || Object.values(metadata).some((v) => typeof v !== "string")) {
      return bad("invalid_metadata", "metadata is up to 20 string values.", "metadata");
    }
  }
  const subscription = body.subscription as CheckoutSessionCreateParams["subscription"];
  if (modes.includes("subscribe") && subscription && subscription.interval !== "month" && subscription.interval !== "week") {
    return bad("invalid_subscription", 'subscription.interval must be "week" or "month".', "subscription");
  }

  return {
    value: {
      amount: formatCents(amountCents),
      currency: "USD",
      description: body.description.trim(),
      lineItems,
      modes: modes as CheckoutMode[],
      successUrl: String(body.successUrl),
      cancelUrl: body.cancelUrl === undefined ? undefined : String(body.cancelUrl),
      metadata: metadata as Record<string, string> | undefined,
      subscription,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    },
  };
}

/* ── Completing a session, and the events it causes ────────────────────── */

const DAY = 86_400;

function eventOf<K extends PolarisEventType>(type: K, data: PolarisEventDataMap[K], now: Date): PolarisEvent {
  return {
    id: `evt_test_${randomBytes(10).toString("hex")}`,
    object: "event",
    type,
    created: Math.floor(now.getTime() / 1000),
    livemode: false,
    data,
  } as PolarisEvent;
}

function fakeTxHash(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

function fakePayer(): Address {
  return `0x${randomBytes(20).toString("hex")}`;
}

export function completeSession(
  id: string,
  mode: CheckoutMode,
  now: Date = new Date(),
): { ok: true; session: MockSession; events: PolarisEvent[] } | { ok: false; status: number; message: string } {
  const session = getSession(id, now);
  if (!session) return { ok: false, status: 404, message: "No such session." };
  if (session.status !== "open") return { ok: false, status: 409, message: `This session is ${session.status}.` };
  if (!session.modes.includes(mode)) return { ok: false, status: 400, message: `This session doesn't offer ${mode}.` };

  session.status = "complete";
  session.mode = mode;
  session.payer = fakePayer();
  const orderId = session.metadata?.orderId;
  const ref = { orderId, sessionId: session.id, metadata: session.metadata };
  const paymentId = `pay_test_${randomBytes(8).toString("hex")}`;
  const events: PolarisEvent[] = [];

  if (mode === "later") {
    const quote = quotePayIn4(session.amount, { aprBps: payInFourApr() });
    const planId = `plan_test_${randomBytes(8).toString("hex")}`;
    const schedule = quote.installments.map((inst) => ({
      index: inst.index,
      amount: inst.amount,
      dueAt: new Date(now.getTime() + inst.dueInSeconds * 1000).toISOString(),
    }));
    session.plan = { planId, collected: 1, total: schedule.length, schedule };
    events.push(
      eventOf(
        "plan.opened",
        {
          ...ref,
          planId,
          amount: session.amount,
          currency: "USD",
          intervalSeconds: quote.intervalSeconds,
          installments: schedule.map((s) => ({ ...s, status: s.index === 1 ? "due" : "upcoming", paidAt: null })),
        },
        now,
      ),
      eventOf("payment.succeeded", { ...ref, paymentId, amount: session.amount, currency: "USD", mode, payer: session.payer, txHash: fakeTxHash() }, now),
      eventOf("installment.collected", { ...ref, planId, index: 1, amount: schedule[0]!.amount, txHash: fakeTxHash() }, now),
    );
  } else if (mode === "subscribe") {
    const subscriptionId = `sub_test_${randomBytes(8).toString("hex")}`;
    session.subscriptionId = subscriptionId;
    session.periodsCharged = 1;
    const txHash = fakeTxHash();
    events.push(
      eventOf("payment.succeeded", { ...ref, paymentId, amount: session.amount, currency: "USD", mode, payer: session.payer, txHash }, now),
      eventOf(
        "subscription.charged",
        {
          ...ref,
          subscriptionId,
          amount: session.amount,
          currency: "USD",
          period: 1,
          interval: session.subscription?.interval ?? "month",
          intervalCount: session.subscription?.intervalCount ?? 1,
          nextChargeAt: addInterval(now, session.subscription?.interval ?? "month", 1).toISOString(),
          txHash,
        },
        now,
      ),
    );
  } else {
    events.push(eventOf("payment.succeeded", { ...ref, paymentId, amount: session.amount, currency: "USD", mode, payer: session.payer, txHash: fakeTxHash() }, now));
  }
  save();
  return { ok: true, session, events };
}

export function cancelSession(id: string): MockSession | null {
  const session = getSession(id);
  if (!session) return null;
  if (session.status === "open") {
    session.status = "canceled";
    save();
  }
  return session;
}

/** The next thing that would happen to a completed session: an instalment, or a renewal. */
export function advanceSession(id: string, now: Date = new Date()): { ok: true; events: PolarisEvent[] } | { ok: false; message: string } {
  const session = getSession(id, now);
  if (!session || session.status !== "complete") return { ok: false, message: "Only a completed session can move forward." };
  const ref = { orderId: session.metadata?.orderId, sessionId: session.id, metadata: session.metadata };
  if (session.plan) {
    const plan = session.plan;
    if (plan.collected >= plan.total) return { ok: false, message: "Every instalment is already collected." };
    plan.collected += 1;
    const inst = plan.schedule[plan.collected - 1]!;
    const events = [eventOf("installment.collected", { ...ref, planId: plan.planId, index: inst.index, amount: inst.amount, txHash: fakeTxHash() }, now)];
    if (plan.collected === plan.total) events.push(eventOf("plan.completed", { ...ref, planId: plan.planId }, now));
    save();
    return { ok: true, events };
  }
  if (session.subscriptionId) {
    const period = (session.periodsCharged ?? 1) + 1;
    session.periodsCharged = period;
    const interval = session.subscription?.interval ?? "month";
    const events = [
      eventOf(
        "subscription.charged",
        {
          ...ref,
          subscriptionId: session.subscriptionId,
          amount: session.amount,
          currency: "USD",
          period,
          interval,
          intervalCount: session.subscription?.intervalCount ?? 1,
          nextChargeAt: addInterval(new Date(session.createdAt ?? now), interval, period).toISOString(),
          txHash: fakeTxHash(),
        },
        now,
      ),
    ];
    save();
    return { ok: true, events };
  }
  return { ok: false, message: "A Pay now order has nothing further to collect." };
}

export function findSessionByOrder(orderId: string): MockSession | null {
  return Object.values(state().sessions).find((s) => s.metadata?.orderId === orderId && s.status === "complete") ?? null;
}

function addInterval(from: Date, interval: "week" | "month", count: number): Date {
  const next = new Date(from);
  if (interval === "week") next.setTime(next.getTime() + count * 7 * DAY * 1000);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

/* ── Direct payments through the mock relayer ──────────────────────────── */

export interface RelayRequest {
  payer: Address;
  merchant: Address;
  amount: string;
  value: string;
  orderId: string;
  validAfter: string;
  validBefore: string;
  signature: Hex;
  chainId: number;
}

export async function relayPayment(
  input: Partial<RelayRequest>,
  now: Date = new Date(),
): Promise<{ ok: true; txHash: Hex; paymentId: Hex; event: PolarisEvent } | { ok: false; status: number; code: string; message: string }> {
  const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
  const { payer, merchant, amount, value, orderId, validAfter, validBefore, signature, chainId } = input;
  if (!payer || !merchant || !amount || !value || !orderId || !validBefore || !signature) {
    return fail(400, "invalid_request", "payer, merchant, amount, value, orderId, validBefore and signature are required.");
  }
  if (chainId !== MONAD_TESTNET.chainId) return fail(400, "wrong_chain", `Signed for chain ${chainId}, not Monad testnet.`);
  let cents: bigint;
  try {
    cents = toCents(amount);
  } catch {
    return fail(400, "invalid_amount", "amount must be a dollar amount.");
  }
  if (BigInt(value) !== cents * 10_000n) return fail(400, "amount_mismatch", "value doesn't match amount.");
  if (BigInt(validBefore) <= BigInt(Math.floor(now.getTime() / 1000))) return fail(400, "authorization_expired", "The authorization has expired.");

  const paymentId = paymentIdFor(merchant, orderId);
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: { ...MOCK_DOMAIN, chainId: MONAD_TESTNET.chainId, verifyingContract: MONAD_TESTNET.stablecoin },
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: payer,
        to: ZERO_ADDRESS,
        value: BigInt(value),
        validAfter: BigInt(validAfter ?? "0"),
        validBefore: BigInt(validBefore),
        nonce: paymentId,
      },
      signature,
    });
  } catch {
    return fail(400, "invalid_signature", "The signature couldn't be read.");
  }
  if (recovered.toLowerCase() !== payer.toLowerCase()) {
    return fail(400, "invalid_signature", "The signature wasn't made by the payer for this merchant and order.");
  }
  const s = state();
  if (s.payments[paymentId]) return fail(409, "duplicate_payment", "This order is already paid.");
  const txHash = fakeTxHash();
  s.payments[paymentId] = { orderId, txHash, at: now.toISOString() };
  save();
  const event = eventOf(
    "payment.succeeded",
    { orderId, paymentId, amount: formatCents(cents), currency: "USD", mode: "direct", payer, txHash },
    now,
  );
  return { ok: true, txHash, paymentId, event };
}

/* ── Delivery ──────────────────────────────────────────────────────────── */

/**
 * Sign and POST events to the store's webhook endpoint, in order. A 409 (an
 * event that arrived before its plan) or a 5xx is retried, as Polaris would.
 */
export async function deliver(
  events: PolarisEvent[],
  webhookUrl: string,
  secret: string = mockKeys().webhookSecret,
  sessionId?: string,
): Promise<MockDelivery[]> {
  const results: MockDelivery[] = [];
  for (const event of events) {
    const body = JSON.stringify(event);
    let status: number | null = null;
    let attempts = 0;
    for (; attempts < 4; ) {
      attempts += 1;
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "polaris-signature": generateTestHeader({ payload: body, secret }),
            "polaris-event": event.type,
            "polaris-delivery-attempt": String(attempts),
          },
          body,
          cache: "no-store",
        });
        status = res.status;
        if (res.ok || (res.status < 500 && res.status !== 409 && res.status !== 429)) break;
      } catch {
        status = null;
      }
      await new Promise((r) => setTimeout(r, 250 * attempts));
    }
    const delivery = { eventId: event.id, type: event.type, status, attempts, at: new Date().toISOString() };
    results.push(delivery);
    if (sessionId) {
      const session = state().sessions[sessionId];
      session?.deliveries.push(delivery);
    }
  }
  if (sessionId) save();
  return results;
}
