import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MONAD_TESTNET, quotePayIn4, type CheckoutMode, type CheckoutSession, type WebhookEvent, type WebhookEventDataMap, type WebhookEventType } from "polarispay-sdk";
import { signWebhookPayload } from "polarispay-sdk/server";
import { encodePacked, keccak256, recoverTypedDataAddress, type Hex } from "viem";

import { micros } from "@/lib/orders/transitions";
import { DEV_MOCK_MERCHANT, DEV_MOCK_PATH, DEV_MOCK_PUBLISHABLE_KEY, payInFourApr } from "@/lib/polaris";

import { devMockSecrets } from "./guard";

type Address = `0x${string}`;

/**
 * A development stand-in for the Polaris API: the same HTTP contract as the
 * real one (POST/GET /api/v1/checkout/sessions, bearer secret key,
 * idempotency keys, validation errors), a test checkout page that speaks the
 * SDK's postMessage protocol, a relayer for direct wallet payments, and
 * webhooks shaped and signed exactly as polarispay-sdk 0.3.0 documents them.
 * State lives in .data/dev-polaris.json.
 *
 * It is labelled as a mock everywhere it shows up, and it moves no money.
 */

/** Monad testnet AUSD's EIP-712 domain (the SDK reads it from the token; the scripted test wallet answers with it). */
export const MOCK_DOMAIN = { name: "Agora Dollar", version: "1" } as const;
/** The stand-in PolarisPayments the dev chain names (see polaris-client.ts): an address no one can call from. */
export const MOCK_PAYMENTS: Address = "0x000000000000000000000000000000000000dEaD";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MERCHANT_ID = "mer_halcyon_dev";

export interface MockDelivery {
  eventId: string;
  type: WebhookEventType;
  status: number | null;
  attempts: number;
  at: string;
}

export interface MockSession extends CheckoutSession {
  webhookUrl: string;
  deliveries: MockDelivery[];
  plan?: { planId: string; collected: number; total: number; schedule: { index: number; amount: string; dueAt: string }[]; totalAmount: string };
  subscriptionId?: string;
  periodsCharged?: number;
  subscriptionCanceled?: boolean;
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

/**
 * The mock's keys. The secret key and webhook secret are random for this dev
 * server process (see devMockSecrets), and the mock never takes a real key
 * from the environment: a developer's POLARIS_SECRET_KEY stays theirs.
 */
export function mockKeys(env: Record<string, string | undefined> = process.env): MockKeys {
  const secrets = devMockSecrets();
  return {
    secretKey: secrets.secretKey,
    publishableKey: DEV_MOCK_PUBLISHABLE_KEY,
    webhookSecret: secrets.webhookSecret,
    merchant: /^0x[0-9a-fA-F]{40}$/.test(env.POLARIS_MERCHANT_ADDRESS?.trim() ?? "") ? (env.POLARIS_MERCHANT_ADDRESS!.trim() as Address) : DEV_MOCK_MERCHANT,
  };
}

/* ── State ─────────────────────────────────────────────────────────────── */

const holder = globalThis as unknown as { __polarisDevMock?: MockState };
const stateFile = () => path.join(process.env.SHOP_DATA_DIR ?? path.join(process.cwd(), ".data"), "dev-polaris.json");
const persist = () => process.env.SHOP_ORDER_STORE !== "memory";

function state(): MockState {
  if (!holder.__polarisDevMock) {
    let loaded: MockState = { sessions: {}, idempotency: {}, payments: {} };
    if (persist()) {
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
  if (!persist()) return;
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

/* ── Money ─────────────────────────────────────────────────────────────── */

const AMOUNT = /^\d+(\.\d{1,2})?$/;

function toCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !AMOUNT.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** AUSD base units (6 decimals) as the API writes amounts: "349.00", "1.745", "50.383562". */
function formatUnits(units: bigint): string {
  let fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${units / 1_000_000n}.${fraction}`;
}

/** PolarisPayments' 0.5% protocol fee on a cents amount. */
function feeFor(cents: bigint): string {
  return formatUnits((cents * 10_000n * 50n) / 10_000n);
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

type CreateBody = {
  amount: string;
  currency: "USD";
  description: string;
  lineItems: { name: string; quantity: number; unitAmount: string }[];
  modes: CheckoutMode[];
  subscription: { interval: "day" | "week" | "month" | "year"; intervalCount: number } | null;
  successUrl: string;
  cancelUrl: string | null;
  orderId: string | null;
  metadata: Record<string, string>;
};

type CreateResult = { status: number; body: unknown; replayed?: boolean };

export function createSession(input: unknown, idempotencyKey: string | null, origin: string, now: Date = new Date()): CreateResult {
  const parsed = validateCreate(input);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };
  const body = parsed.value;

  const print = createHash("sha256").update(JSON.stringify(body)).digest("hex");
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
    paymentStatus: "unpaid",
    livemode: false,
    amount: body.amount,
    currency: "USD",
    description: body.description,
    lineItems: body.lineItems.map((item) => ({ ...item, amount: formatCents(toCents(item.unitAmount)! * BigInt(item.quantity)) })),
    modes: body.modes,
    subscription: body.subscription,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    orderId: body.orderId,
    metadata: body.metadata,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    completedAt: null,
    payment: null,
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

/** The session as the API returns it: the mock's bookkeeping stays inside. */
export function publicSession(session: MockSession, now: Date = new Date()): CheckoutSession {
  const current = getSession(session.id, now) ?? session;
  const { webhookUrl: _url, deliveries: _deliveries, plan: _plan, subscriptionId: _sub, periodsCharged: _periods, subscriptionCanceled: _canceled, ...rest } = current;
  void _url;
  void _deliveries;
  void _plan;
  void _sub;
  void _periods;
  void _canceled;
  return rest;
}

function validateCreate(input: unknown): { value: CreateBody } | { error: { type: string; code: string; message: string; param?: string } } {
  const bad = (code: string, message: string, param?: string) => ({ error: { type: "invalid_request_error", code, message, param } });
  if (typeof input !== "object" || input === null) return bad("invalid_body", "The body must be a JSON object.");
  const body = input as Record<string, unknown>;

  const amount = toCents(body.amount);
  if (amount === null) return bad("invalid_amount", 'amount must be a positive dollar amount like "200.00".', "amount");
  if (body.currency !== "USD") return bad("invalid_currency", 'currency must be "USD".', "currency");
  if (typeof body.description !== "string" || !body.description.trim()) return bad("invalid_description", "description is required.", "description");

  const modes = body.modes;
  if (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => m === "now" || m === "later" || m === "subscribe")) {
    return bad("invalid_modes", 'modes must list at least one of "now", "later", "subscribe".', "modes");
  }
  if (new Set(modes).size !== modes.length) return bad("invalid_modes", "modes has a duplicate.", "modes");

  const subscription = body.subscription as CreateBody["subscription"] | undefined;
  if (modes.includes("subscribe")) {
    if (!subscription || !["day", "week", "month", "year"].includes(subscription.interval)) {
      return bad("invalid_subscription", 'subscription.interval must be "day", "week", "month" or "year".', "subscription.interval");
    }
  } else if (subscription) {
    return bad("invalid_subscription", 'subscription only applies when modes includes "subscribe".', "subscription");
  }

  for (const field of ["successUrl", "cancelUrl"] as const) {
    const value = body[field];
    if ((value === undefined || value === null) && field === "cancelUrl") continue;
    try {
      const url = new URL(String(value).replace("{CHECKOUT_SESSION_ID}", "cs_placeholder"));
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return bad("invalid_url", `${field} must be an absolute URL.`, field);
    }
  }

  const rawItems = body.lineItems;
  if (rawItems !== undefined && !Array.isArray(rawItems)) return bad("invalid_line_items", "lineItems must be a list.", "lineItems");
  const lineItems: CreateBody["lineItems"] = [];
  let sum = 0n;
  for (const [i, raw] of ((rawItems as unknown[]) ?? []).entries()) {
    const item = raw as { name?: unknown; quantity?: unknown; unitAmount?: unknown };
    const unit = toCents(item?.unitAmount);
    const quantity = item?.quantity ?? 1;
    if (typeof item?.name !== "string" || !item.name.trim() || unit === null || !Number.isInteger(quantity) || (quantity as number) < 1) {
      return bad("invalid_line_item", `lineItems[${i}] needs a name, a whole quantity and a unitAmount like "12.00".`, `lineItems[${i}]`);
    }
    sum += unit * BigInt(quantity as number);
    lineItems.push({ name: item.name.trim(), quantity: quantity as number, unitAmount: formatCents(unit) });
  }
  if (lineItems.length > 0 && sum !== amount) {
    return bad("amount_mismatch", `amount ${formatCents(amount)} doesn't match the line items, which add up to ${formatCents(sum)}.`, "amount");
  }

  const metadata = (body.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata !== "object" || Object.keys(metadata).length > 20 || Object.values(metadata).some((v) => typeof v !== "string")) {
    return bad("invalid_metadata", "metadata is up to 20 string values.", "metadata");
  }
  const orderId = body.orderId;
  if (orderId !== undefined && orderId !== null && (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 200)) {
    return bad("invalid_order_id", "orderId must be 1 to 200 characters.", "orderId");
  }

  return {
    value: {
      amount: formatCents(amount),
      currency: "USD",
      description: body.description.trim(),
      lineItems,
      modes: modes as CheckoutMode[],
      subscription: subscription ? { interval: subscription.interval, intervalCount: subscription.intervalCount ?? 1 } : null,
      successUrl: String(body.successUrl),
      cancelUrl: body.cancelUrl === undefined || body.cancelUrl === null ? null : String(body.cancelUrl),
      orderId: (orderId as string | null | undefined) ?? null,
      metadata: metadata as Record<string, string>,
    },
  };
}

/* ── Completing a session, and the events it causes ────────────────────── */

function eventOf<K extends WebhookEventType>(type: K, data: WebhookEventDataMap[K], now: Date): WebhookEvent {
  return {
    id: `evt_test_${randomBytes(10).toString("hex")}`,
    object: "event",
    type,
    createdAt: now.toISOString(),
    livemode: false,
    merchantId: MERCHANT_ID,
    data,
  } as WebhookEvent;
}

const fakeTxHash = (): Hex => `0x${randomBytes(32).toString("hex")}`;
const fakeAddress = (): Address => `0x${randomBytes(20).toString("hex")}`;
const chainId = MONAD_TESTNET.chainId;

export type CompletedSession = {
  session: MockSession;
  events: WebhookEvent[];
  /** What the test checkout posts back to the store: the protocol's "completed" details. */
  result: { mode: CheckoutMode; orderId: string | null; txHash: Hex; paymentId?: Hex; planId?: string; subscriptionId?: string };
};

export function completeSession(id: string, mode: CheckoutMode, now: Date = new Date()): ({ ok: true } & CompletedSession) | { ok: false; status: number; message: string } {
  const session = getSession(id, now);
  if (!session) return { ok: false, status: 404, message: "No such session." };
  if (session.status !== "open") return { ok: false, status: 409, message: `This session is ${session.status}.` };
  if (!session.modes.includes(mode)) return { ok: false, status: 400, message: `This session doesn't offer ${mode}.` };

  const orderId = session.orderId ?? session.id;
  const ref = { orderId, sessionId: session.id, metadata: session.metadata };
  const buyer = fakeAddress();
  const merchant = mockKeys().merchant;
  const cents = toCents(session.amount)!;
  const txHash = fakeTxHash();
  const events: WebhookEvent[] = [];
  const result: CompletedSession["result"] = { mode, orderId: session.orderId, txHash };
  let payment: CheckoutSession["payment"];

  if (mode === "later") {
    // Exactly PolarisLoanEngine's terms, as the real API reports them: simple
    // interest at the loan engine's rate, instalments in AUSD's six decimals,
    // the first due one interval after opening, and nothing collected now.
    const quote = quotePayIn4(session.amount, { aprBps: payInFourApr() });
    const planId = `${BigInt(`0x${randomBytes(4).toString("hex")}`)}`;
    const principalUnits = cents * 10_000n;
    const totalUnits = quote.installments.reduce((n, inst) => n + inst.amountBaseUnits, 0n);
    const schedule = quote.installments.map((inst) => ({
      index: inst.index,
      amount: formatUnits(inst.amountBaseUnits),
      dueAt: new Date(now.getTime() + inst.dueInSeconds * 1000).toISOString(),
    }));
    session.plan = { planId, collected: 0, total: schedule.length, schedule, totalAmount: formatUnits(totalUnits) };
    events.push(
      eventOf(
        "plan.opened",
        {
          ...ref,
          txHash,
          chainId,
          planId,
          mode: "later",
          merchant,
          borrower: buyer,
          principal: session.amount,
          interest: formatUnits(totalUnits - principalUnits),
          total: formatUnits(totalUnits),
          installments: schedule.length,
          intervalSeconds: quote.intervalSeconds,
          schedule,
          currency: "USD",
        },
        now,
      ),
    );
    result.planId = planId;
    payment = { mode, payer: buyer, txHash, chainId, paymentId: null, planId, subscriptionId: null };
  } else if (mode === "subscribe") {
    const subscriptionId = `${BigInt(`0x${randomBytes(4).toString("hex")}`)}`;
    session.subscriptionId = subscriptionId;
    session.periodsCharged = 1;
    events.push(
      eventOf(
        "subscription.charged",
        {
          txHash,
          chainId,
          subscriptionId,
          planId: "1",
          merchant,
          subscriber: buyer,
          amount: session.amount,
          fee: feeFor(cents),
          period: 1,
          nextChargeAt: addInterval(now, session.subscription?.interval ?? "month", 1).toISOString(),
          orderId,
          sessionId: session.id,
        },
        now,
      ),
    );
    result.subscriptionId = subscriptionId;
    payment = { mode, payer: buyer, txHash, chainId, paymentId: null, planId: null, subscriptionId };
  } else {
    const paymentId = keccak256(encodePacked(["address", "string"], [merchant, orderId]));
    events.push(
      eventOf(
        "payment.succeeded",
        { ...ref, txHash, chainId, paymentId, mode: "now", merchant, payer: buyer, amount: session.amount, fee: feeFor(cents), currency: "USD" },
        now,
      ),
    );
    result.paymentId = paymentId;
    payment = { mode, payer: buyer, txHash, chainId, paymentId, planId: null, subscriptionId: null };
  }

  session.status = "complete";
  session.paymentStatus = "paid";
  session.completedAt = now.toISOString();
  session.payment = payment;
  save();
  return { ok: true, session, events, result };
}

export function cancelSession(id: string): MockSession | null {
  return getSession(id);
}

/**
 * The next thing that would happen to a completed session: an instalment, or
 * a renewal. Or, with "cancel", the buyer canceling their subscription in Polaris.
 */
export function advanceSession(
  id: string,
  action: "next" | "cancel" = "next",
  now: Date = new Date(),
): { ok: true; events: WebhookEvent[] } | { ok: false; message: string } {
  const session = getSession(id, now);
  if (!session || session.status !== "complete") return { ok: false, message: "Only a completed session can move forward." };
  const orderId = session.orderId ?? session.id;
  if (action === "cancel") {
    if (!session.subscriptionId) return { ok: false, message: "Only a subscription can be canceled." };
    if (session.subscriptionCanceled) return { ok: false, message: "This subscription is already canceled." };
    session.subscriptionCanceled = true;
    save();
    return {
      ok: true,
      events: [
        eventOf(
          "subscription.canceled",
          {
            txHash: fakeTxHash(),
            chainId,
            subscriptionId: session.subscriptionId,
            planId: "1",
            merchant: mockKeys().merchant,
            subscriber: session.payment?.payer ?? fakeAddress(),
            canceledBy: "subscriber",
          },
          now,
        ),
      ],
    };
  }
  if (session.plan) {
    const plan = session.plan;
    if (plan.collected >= plan.total) return { ok: false, message: "Every instalment is already collected." };
    plan.collected += 1;
    const inst = plan.schedule[plan.collected - 1]!;
    const paidSoFar = plan.schedule.slice(0, plan.collected).reduce((n, s) => n + (micros(s.amount) ?? 0n), 0n);
    const remaining = (micros(plan.totalAmount) ?? 0n) - paidSoFar;
    const events = [
      eventOf(
        "installment.collected",
        {
          txHash: fakeTxHash(),
          chainId,
          planId: plan.planId,
          orderId,
          installment: inst.index,
          installments: plan.total,
          amount: inst.amount,
          remaining: formatUnits(remaining > 0n ? remaining : 0n),
        },
        now,
      ),
    ];
    if (plan.collected === plan.total) {
      events.push(eventOf("plan.completed", { txHash: fakeTxHash(), chainId, planId: plan.planId, orderId, total: plan.totalAmount }, now));
    }
    save();
    return { ok: true, events };
  }
  if (session.subscriptionId) {
    if (session.subscriptionCanceled) return { ok: false, message: "This subscription is canceled." };
    const period = (session.periodsCharged ?? 1) + 1;
    session.periodsCharged = period;
    const interval = session.subscription?.interval ?? "month";
    const events = [
      eventOf(
        "subscription.charged",
        {
          txHash: fakeTxHash(),
          chainId,
          subscriptionId: session.subscriptionId,
          planId: "1",
          merchant: mockKeys().merchant,
          subscriber: session.payment?.payer ?? fakeAddress(),
          amount: session.amount,
          fee: feeFor(toCents(session.amount)!),
          period,
          nextChargeAt: addInterval(new Date(session.createdAt), interval, period).toISOString(),
          orderId,
          sessionId: session.id,
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
  return Object.values(state().sessions).find((s) => s.orderId === orderId && s.status === "complete") ?? null;
}

function addInterval(from: Date, interval: "day" | "week" | "month" | "year", count: number): Date {
  const next = new Date(from);
  if (interval === "day") next.setUTCDate(next.getUTCDate() + count);
  else if (interval === "week") next.setUTCDate(next.getUTCDate() + 7 * count);
  else if (interval === "year") next.setUTCFullYear(next.getUTCFullYear() + count);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

/* ── Direct payments through the mock relayer ──────────────────────────── */

/** polarispay-sdk's RelayPayRequest. */
export interface RelayRequest {
  type: "payWithAuthorization";
  chainId: number;
  contract: Address;
  payer: Address;
  merchant: Address;
  /** AUSD base units. */
  amount: string;
  orderId: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
}

const RECEIVE_WITH_AUTHORIZATION = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Check a relay request the way PolarisPayments.payWithAuthorization and
 * AUSD would, without sending anything: the right chain and contract, a
 * nonce bound to this merchant and order, a live window, and a signature
 * from the payer.
 */
export async function relayPayment(
  input: Partial<RelayRequest>,
  now: Date = new Date(),
): Promise<{ ok: true; txHash: Hex; paymentId: Hex; event: WebhookEvent } | { ok: false; status: number; code: string; message: string }> {
  const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
  const { type, chainId: signedChain, contract, payer, merchant, amount, orderId, validAfter, validBefore, nonce, signature } = input;
  if (type !== "payWithAuthorization") return fail(400, "invalid_type", 'type must be "payWithAuthorization".');
  if (!payer || !merchant || !amount || !orderId || !validBefore || !nonce || !signature || !contract) {
    return fail(400, "invalid_request", "payer, merchant, amount, orderId, validBefore, nonce, signature and contract are required.");
  }
  if (signedChain !== chainId) return fail(400, "wrong_chain", `Signed for chain ${signedChain}, not Monad testnet.`);
  // Polaris relays payments to the merchant that holds the publishable key, and to no one else.
  if (merchant.toLowerCase() !== mockKeys().merchant.toLowerCase()) return fail(400, "unknown_merchant", "This key can't pay that address.");
  if (contract.toLowerCase() !== MOCK_PAYMENTS.toLowerCase()) return fail(400, "wrong_contract", "The relayer only submits to PolarisPayments.");
  if (!/^\d+$/.test(amount) || BigInt(amount) === 0n) return fail(400, "invalid_amount", "amount must be AUSD base units.");
  if (BigInt(validBefore) <= BigInt(Math.floor(now.getTime() / 1000))) return fail(400, "authorization_expired", "The authorization has expired.");

  const paymentId = keccak256(encodePacked(["address", "string"], [merchant, orderId]));
  if (paymentId.toLowerCase() !== nonce.toLowerCase()) return fail(400, "nonce_mismatch", "The nonce isn't this merchant and order.");

  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: { ...MOCK_DOMAIN, chainId, verifyingContract: MONAD_TESTNET.stablecoin },
      types: RECEIVE_WITH_AUTHORIZATION,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: payer,
        to: contract,
        value: BigInt(amount),
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
  if (s.payments[paymentId]) return fail(409, "duplicate_payment", "This order has already been paid.");
  const txHash = fakeTxHash();
  s.payments[paymentId] = { orderId, txHash, at: now.toISOString() };
  save();

  const units = BigInt(amount);
  const cents = units / 10_000n;
  const event = eventOf(
    "payment.succeeded",
    {
      txHash,
      chainId,
      orderId,
      sessionId: null,
      metadata: {},
      paymentId,
      mode: "now",
      merchant,
      payer,
      amount: formatUnits(units),
      fee: feeFor(cents),
      currency: "USD",
    },
    now,
  );
  return { ok: true, txHash, paymentId, event };
}

/* ── Delivery ──────────────────────────────────────────────────────────── */

/**
 * Sign and POST events to the store's webhook endpoint, in order. A 404 (an
 * order the store hasn't stored yet), a 409 (an event that arrived before its
 * plan), a 429 or a 5xx is retried, as Polaris would.
 */
export async function deliver(
  events: WebhookEvent[],
  webhookUrl: string,
  secret: string = mockKeys().webhookSecret,
  sessionId?: string,
): Promise<MockDelivery[]> {
  const results: MockDelivery[] = [];
  for (const event of events) {
    const body = JSON.stringify(event);
    let status: number | null = null;
    let attempts = 0;
    while (attempts < 4) {
      attempts += 1;
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "polaris-signature": signWebhookPayload(body, secret),
            "polaris-event": event.type,
            "polaris-delivery-attempt": String(attempts),
          },
          body,
          cache: "no-store",
        });
        status = res.status;
        if (res.ok || (res.status < 500 && ![404, 409, 429].includes(res.status))) break;
      } catch {
        status = null;
      }
      await new Promise((r) => setTimeout(r, 250 * attempts));
    }
    const delivery = { eventId: event.id, type: event.type, status, attempts, at: new Date().toISOString() };
    results.push(delivery);
    if (sessionId) state().sessions[sessionId]?.deliveries.push(delivery);
  }
  if (sessionId) save();
  return results;
}
