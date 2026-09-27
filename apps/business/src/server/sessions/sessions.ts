import "server-only";

import { newId, randomBase62, type CheckoutSessionRecord, type LinkRecord, type MerchantRecord } from "@polaris/db";
import { encodeFunctionData, encodePacked, getAddress, keccak256, parseEventLogs, type Address, type Hex } from "viem";

import { iausdAbi, merchantRegistryAbi, polarisCheckoutAbi, polarisPaymentsAbi } from "../chain/abis";
import { publicClient, requireChain } from "../chain/client";
import { centsToUnits, formatCents, formatUnits, installmentAmounts, quotePlanLocally } from "../chain/money";
import { getDb } from "../db";
import { getConfig, type ServerConfig } from "../env";
import { HttpError } from "../http";
import { consume, LIMITS } from "../ratelimit";
import { carry } from "../relayer/carry";
import { RelayRejected, RelayUnavailable } from "../relayer/submit";
import type { CreateSessionInput } from "./params";
import { periodSeconds } from "./params";

/**
 * Checkout sessions: what a merchant's server creates with
 * `polaris.checkout.sessions.create`, what the hosted checkout reads, and
 * what the relayer checks every buyer signature against.
 *
 * A session fixes, at creation, everything the buyer will sign: the
 * merchant's wallet, the amount, and the on-chain order id (the merchant's
 * `orderId`, else the session id), whose key `keccak256(merchant, orderId)`
 * is the Pay-now nonce and PolarisPayments' payment id. The relayer refuses
 * any signature that doesn't match, and the contracts settle an order once.
 *
 * The price is also pinned on chain before the session is handed out
 * (`PolarisPayments.quoteOrder`, sent by the relayer as operator), because
 * the order id is public (it is the session id, or in the hosted checkout's
 * view of it) and an unquoted order belongs to whoever pays it first, at any
 * amount. Once quoted, every payment path (Pay now, Pay in 4, Subscribe,
 * PolarisPayments directly) refuses any other amount.
 *
 * Status: `open` → `complete` (only from a chain event that matches the
 * session: its amount, a mode it offers, its plan) or `expired` (computed
 * from `expiresAt`). A settlement that doesn't match is recorded on the
 * session as a mismatch and never completes it (ingest/ingest.ts).
 */

export function orderKeyOf(merchant: Address, orderId: string): Hex {
  return keccak256(encodePacked(["address", "string"], [merchant, orderId]));
}

export function sessionUrl(id: string, config: ServerConfig = getConfig()): string {
  return `${config.checkoutOrigin}/pay/${id}`;
}

/** The SDK's `CheckoutSession`, field for field. */
export function toApiSession(s: CheckoutSessionRecord) {
  return {
    id: s.id,
    object: "checkout.session" as const,
    url: sessionUrl(s.id),
    status: effectiveStatus(s),
    paymentStatus: s.status === "complete" ? ("paid" as const) : ("unpaid" as const),
    livemode: s.livemode,
    amount: formatCents(s.amountCents),
    currency: "USD" as const,
    description: s.description,
    lineItems: s.lineItems.map((li) => ({
      name: li.name,
      quantity: li.quantity,
      unitAmount: formatCents(li.unitAmountCents),
      amount: formatCents(li.unitAmountCents * li.quantity),
    })),
    modes: s.modes,
    subscription: s.subscription,
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    orderId: s.orderId,
    metadata: s.metadata,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    completedAt: s.completedAt,
    payment: s.payment,
  };
}

export type ApiSession = ReturnType<typeof toApiSession>;

export function effectiveStatus(s: CheckoutSessionRecord, nowMs = Date.now()): CheckoutSessionRecord["status"] {
  if (s.status === "open" && Date.parse(s.expiresAt) <= nowMs) return "expired";
  return s.status;
}

/** Persist an expiry that time has already decided. */
async function settleExpiry(s: CheckoutSessionRecord): Promise<CheckoutSessionRecord> {
  if (s.status !== "open" || effectiveStatus(s) !== "expired") return s;
  return (await getDb().sessions.update(s.id, (cur) => (cur.status === "open" ? { ...cur, status: "expired" } : cur))) ?? s;
}

export async function createSession(
  merchant: MerchantRecord,
  input: CreateSessionInput,
  options: { linkId?: string | null; ttlSeconds?: number; livemode?: boolean } = {},
): Promise<CheckoutSessionRecord> {
  const config = getConfig();
  const chain = requireChain();
  if (!merchant.walletAddress) {
    throw new HttpError(409, "account_incomplete", "This merchant's payout account isn't set up yet: sign in to Polaris for Business once to finish.");
  }
  const id = `cs_${options.livemode ? "live" : "test"}_${randomBase62(24)}`;
  const chainOrderId = input.orderId ?? id;
  const orderKey = orderKeyOf(merchant.walletAddress, chainOrderId);

  const db = getDb();
  const settled = await db.sessions.findOne({ orderKey: orderKey.toLowerCase(), status: "complete" });
  if (settled) {
    throw new HttpError(409, "order_already_paid", `Order ${JSON.stringify(chainOrderId)} has already been paid (session ${settled.id}). Use a new orderId.`, {
      param: "orderId",
    });
  }

  const quote = await pinPrice(merchant, id, orderKey, centsToUnits(input.amountCents), chainOrderId);

  const now = new Date();
  const record: CheckoutSessionRecord = {
    id,
    merchantId: merchant.id,
    livemode: Boolean(options.livemode),
    status: "open",
    amountCents: input.amountCents,
    currency: "USD",
    description: input.description,
    lineItems: input.lineItems,
    modes: input.modes,
    subscription: input.subscription,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    orderId: input.orderId,
    metadata: input.metadata,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (options.ttlSeconds ?? config.sessionTtlSeconds) * 1000).toISOString(),
    completedAt: null,
    linkId: options.linkId ?? null,
    chain: { chainId: chain.id, merchant: merchant.walletAddress, orderId: chainOrderId, orderKey, subscriptionPlanId: null, quote },
    payment: null,
  };
  await db.sessions.insert(record);
  return record;
}

let warnedUnquoted = false;

/**
 * Pin the session's price on its order before the order id is handed out:
 * `PolarisPayments.quoteOrder(merchant, orderKey, amount)`, sent by the
 * relayer on its operator role. Takes the order key, not the id, so the
 * quote itself reveals nothing a front-runner could pay.
 *
 * Without a relayer (local development with RELAYER_MODE=off) there is
 * nothing to send it with, and no relayed payment can happen either; the
 * session is created unquoted and ingestion still refuses any settlement
 * that doesn't match it.
 */
async function pinPrice(merchant: MerchantRecord, sessionId: string, orderKey: Hex, amountUnits: bigint, chainOrderId: string): Promise<NonNullable<CheckoutSessionRecord["chain"]["quote"]> | null> {
  const config = getConfig();
  const chain = requireChain();
  if (config.relayer.mode === "off") {
    if (!warnedUnquoted) console.warn("[sessions] no relayer: checkout sessions are created without an on-chain price quote");
    warnedUnquoted = true;
    return null;
  }
  try {
    const result = await carry({
      kind: "quoteOrder",
      relayId: `quote:${sessionId}`,
      to: chain.contracts.payments,
      data: encodeFunctionData({ abi: polarisPaymentsAbi, functionName: "quoteOrder", args: [merchant.walletAddress as Address, orderKey, amountUnits] }),
      signer: null,
      merchantId: merchant.id,
      // Not the session's settlement: it must not count as a payment in flight.
      sessionId: null,
    });
    return { amountUnits: amountUnits.toString(), txHash: result.txHash, at: new Date().toISOString() };
  } catch (error) {
    if (error instanceof RelayRejected && error.error.code === "already_paid") {
      throw new HttpError(409, "order_already_paid", `Order ${JSON.stringify(chainOrderId)} has already been paid on chain. Use a new orderId.`, { param: "orderId" });
    }
    const reason = error instanceof RelayRejected || error instanceof RelayUnavailable || error instanceof HttpError ? error.message : String(error);
    console.error(`[sessions] couldn't pin the price of ${sessionId}: ${reason}`);
    throw new HttpError(503, "price_not_pinned", "The checkout couldn't be created right now: its price couldn't be locked on chain. Nothing was created; try again.", {
      headers: { "Retry-After": "2" },
    });
  }
}

export async function retrieveSession(merchant: MerchantRecord, id: string): Promise<CheckoutSessionRecord> {
  const s = await getDb().sessions.get(id);
  // Another merchant's session is indistinguishable from no session.
  if (!s || s.merchantId !== merchant.id) throw new HttpError(404, "not_found", `No checkout session ${id}.`, { param: "id" });
  return settleExpiry(s);
}

/** A session the relayer may still settle, or the reason it can't. */
export async function openSessionForPayment(id: unknown): Promise<{ session: CheckoutSessionRecord; merchant: MerchantRecord }> {
  if (typeof id !== "string" || !/^cs_(test|live)_[A-Za-z0-9]{8,128}$/.test(id)) {
    throw new HttpError(400, "invalid_request", "sessionId is missing or malformed.", { param: "sessionId" });
  }
  const db = getDb();
  const found = await db.sessions.get(id);
  if (!found) throw new HttpError(404, "not_found", "This checkout doesn't exist.");
  const session = await settleExpiry(found);
  if (session.status === "complete") throw new HttpError(409, "already_paid", "This has already been paid.");
  if (session.status === "expired") throw new HttpError(410, "session_expired", "This checkout has expired. Go back to the shop and start again.");
  if (session.mismatches?.length) {
    // Its order was settled on chain some other way (another amount or mode): it can't be paid again.
    throw new HttpError(409, "order_settled_elsewhere", "This order was already settled another way. Go back to the shop and start again.");
  }
  const merchant = await db.merchants.get(session.merchantId);
  if (!merchant) throw new HttpError(404, "not_found", "This checkout doesn't exist.");
  return { session, merchant };
}

/* ── What the hosted checkout reads ─────────────────────────────────────── */

const eligibility = new Map<string, { ok: boolean; at: number }>();

export function resetEligibilityForTests(): void {
  eligibility.clear();
}

/** MerchantRegistry.canOriginate, cached for 30 s. */
async function canOriginate(merchant: Address, principalUnits: bigint): Promise<boolean> {
  const key = `${merchant}:${principalUnits}`;
  const hit = eligibility.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  const chain = requireChain();
  let ok = false;
  try {
    ok = (await publicClient().readContract({
      address: chain.contracts.registry,
      abi: merchantRegistryAbi,
      functionName: "canOriginate",
      args: [merchant, principalUnits],
    })) as boolean;
  } catch {
    ok = false;
  }
  eligibility.set(key, { ok, at: Date.now() });
  return ok;
}

function resolveUrl(template: string | null, id: string): string | null {
  return template ? template.replaceAll("{CHECKOUT_SESSION_ID}", id) : null;
}

/**
 * The hosted checkout's view of a session. Public by design: anyone with the
 * link may pay it. It carries what the buyer's app needs to build the exact
 * typed data the relayer will accept, and nothing else: no metadata, no
 * merchant email, no key.
 */
export async function publicSession(id: string, options: { buyer?: Address | null } = {}) {
  const db = getDb();
  const config = getConfig();
  const chain = requireChain();
  const found = await db.sessions.get(id);
  if (!found) throw new HttpError(404, "not_found", "This checkout doesn't exist.");
  let session = await settleExpiry(found);
  const merchant = await db.merchants.get(session.merchantId);
  if (!merchant) throw new HttpError(404, "not_found", "This checkout doesn't exist.");

  if (session.status === "open" && session.modes.includes("subscribe") && !session.chain.subscriptionPlanId) {
    try {
      await ensureSubscriptionPlan(session);
      session = (await db.sessions.get(id)) ?? session;
    } catch (error) {
      console.error("[sessions] couldn't publish the subscription plan", error);
    }
  }

  const amountUnits = centsToUnits(session.amountCents);
  let payIn4 = null;
  if (session.modes.includes("later")) {
    const { interest, total } = quotePlanLocally(amountUnits, config.payIn4.installments, config.payIn4.intervalSeconds);
    let reason: string | null = null;
    if (session.amountCents < config.payIn4.minCents) reason = `Pay in 4 starts at $${formatCents(config.payIn4.minCents)}.`;
    else if (session.amountCents > config.payIn4.maxCents) reason = `Pay in 4 goes up to $${formatCents(config.payIn4.maxCents)}.`;
    else if (config.relayer.mode === "off") reason = "Pay in 4 isn't available right now.";
    else if (!(await canOriginate(session.chain.merchant, amountUnits))) reason = "This business can't offer Pay in 4 for this amount yet.";
    payIn4 = {
      available: reason === null,
      reason,
      installments: config.payIn4.installments,
      intervalSeconds: config.payIn4.intervalSeconds,
      aprBps: 1000,
      principal: formatUnits(amountUnits),
      interest: formatUnits(interest),
      total: formatUnits(total),
      principalUnits: amountUnits.toString(),
      totalUnits: total.toString(),
      schedule: installmentAmounts(total, config.payIn4.installments).map((amount, i) => ({
        index: i + 1,
        amount: formatUnits(amount),
        amountUnits: amount.toString(),
        dueInSeconds: (i + 1) * config.payIn4.intervalSeconds,
      })),
    };
  }

  const successUrl = resolveUrl(session.successUrl, session.id) as string;
  const buyer = options.buyer && session.status === "open" ? await buyerState(options.buyer, amountUnits, session.modes.includes("later"), config.payIn4) : null;
  return {
    id: session.id,
    object: "checkout.session.public" as const,
    status: session.status,
    livemode: session.livemode,
    merchant: { id: merchant.publicId, name: merchant.businessName ?? "Polaris merchant", address: session.chain.merchant },
    description: session.description,
    amount: formatCents(session.amountCents),
    amountCents: session.amountCents,
    currency: "USD" as const,
    lineItems: session.lineItems.map((li) => ({
      name: li.name,
      quantity: li.quantity,
      unitAmount: formatCents(li.unitAmountCents),
      amount: formatCents(li.unitAmountCents * li.quantity),
    })),
    modes: session.modes,
    orderId: session.orderId,
    payIn4,
    subscription: session.subscription
      ? {
          ...session.subscription,
          periodSeconds: periodSeconds(session.subscription),
          planId: session.chain.subscriptionPlanId,
          pricePerPeriod: formatUnits(amountUnits),
          pricePerPeriodUnits: amountUnits.toString(),
          /** Periods the buyer's permit covers up front ("a year of periods", plan §5.3). */
          periodsAuthorised: 12,
        }
      : null,
    chain: {
      chainId: chain.id,
      merchant: session.chain.merchant,
      orderId: session.chain.orderId,
      orderKey: session.chain.orderKey,
      amountUnits: amountUnits.toString(),
      contracts: {
        stablecoin: chain.contracts.stablecoin,
        payments: chain.contracts.payments,
        checkout: chain.contracts.checkout,
        loanEngine: chain.contracts.loanEngine,
      },
      stablecoinDomain: { name: chain.stablecoinDomain.name, version: chain.stablecoinDomain.version },
      explorerUrl: chain.explorerUrl,
    },
    successUrl,
    cancelUrl: resolveUrl(session.cancelUrl, session.id),
    /** Where the checkout posts its result (`window.opener.postMessage(…, returnOrigin)`), never "*". */
    returnOrigin: new URL(successUrl).origin,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
    payment: session.payment,
    /** With `?buyer=0x…`: the nonces and Pay in 4 quote that buyer signs against, read from the chain now. */
    buyer,
  };
}

/** What a buyer's signatures depend on right now: their checkout and token nonces, and the loan engine's quote. */
async function buyerState(buyer: Address, principal: bigint, later: boolean, payIn4: ServerConfig["payIn4"]) {
  const chain = requireChain();
  const client = publicClient();
  const [checkoutNonce, tokenNonce, quote] = await Promise.all([
    client.readContract({ address: chain.contracts.checkout, abi: polarisCheckoutAbi, functionName: "nonces", args: [buyer] }) as Promise<bigint>,
    client.readContract({ address: chain.contracts.stablecoin, abi: iausdAbi, functionName: "nonces", args: [buyer] }) as Promise<bigint>,
    later
      ? (client.readContract({
          address: chain.contracts.checkout,
          abi: polarisCheckoutAbi,
          functionName: "quotePlan",
          args: [buyer, principal, payIn4.installments, BigInt(payIn4.intervalSeconds)],
        }) as Promise<{ totalOwed: bigint; interest: bigint; installmentAmount: bigint; permitValue: bigint; creditLimit: bigint; activeDebt: bigint; available: bigint; withinLimit: boolean }>).catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    address: buyer,
    checkoutNonce: checkoutNonce.toString(),
    tokenNonce: tokenNonce.toString(),
    quote: quote
      ? {
          totalOwed: quote.totalOwed.toString(),
          interest: quote.interest.toString(),
          installmentAmount: quote.installmentAmount.toString(),
          permitValue: quote.permitValue.toString(),
          creditLimit: quote.creditLimit.toString(),
          activeDebt: quote.activeDebt.toString(),
          available: quote.available.toString(),
          withinLimit: quote.withinLimit,
        }
      : null,
  };
}

export type PublicSession = Awaited<ReturnType<typeof publicSession>>;

/* ── Subscriptions need a plan on chain ─────────────────────────────────── */

const publishing = new Map<string, Promise<string>>();

/**
 * A "subscribe" session needs a PolarisPayments plan with its price and
 * period before the buyer can sign a SubscribeIntent for it. The relayer
 * (a PolarisPayments operator) publishes one per merchant, price and period
 * with `createPlanFor`, and every later session with the same terms reuses it.
 */
export async function ensureSubscriptionPlan(session: CheckoutSessionRecord): Promise<string | null> {
  if (!session.modes.includes("subscribe") || !session.subscription) return null;
  if (session.chain.subscriptionPlanId) return session.chain.subscriptionPlanId;
  const db = getDb();
  const chain = requireChain();
  const units = centsToUnits(session.amountCents);
  const period = periodSeconds(session.subscription);
  const terms = `${session.chain.merchant}:${units}:${period}`.toLowerCase();

  let pending = publishing.get(terms);
  if (!pending) {
    pending = (async () => {
      const existing = await db.subscriptionPlans.findOne({ terms });
      if (existing) return existing.id;
      const name = session.description.slice(0, 64);
      const result = await carry({
        kind: "createSubscriptionPlan",
        relayId: `plan:${terms}`,
        to: chain.contracts.payments,
        data: encodeFunctionData({
          abi: polarisPaymentsAbi,
          functionName: "createPlanFor",
          args: [session.chain.merchant, units, BigInt(period), name],
        }),
        signer: null,
        merchantId: session.merchantId,
        // Not the session's settlement: it must not count as a payment in flight.
        sessionId: null,
      });
      const receipt = await publicClient().getTransactionReceipt({ hash: result.txHash });
      const [created] = parseEventLogs({ abi: polarisPaymentsAbi, logs: receipt.logs, eventName: "PlanCreated" });
      if (!created) throw new Error("createPlanFor didn't emit PlanCreated");
      const planId = (created.args as { planId: bigint }).planId.toString();
      await db.subscriptionPlans.upsert({
        id: planId,
        merchantId: session.merchantId,
        merchant: getAddress(session.chain.merchant),
        terms,
        priceUnits: units.toString(),
        periodSeconds: period,
        name,
        txHash: result.txHash,
        createdAt: new Date().toISOString(),
      });
      return planId;
    })().finally(() => publishing.delete(terms));
    publishing.set(terms, pending);
  }
  const planId = await pending;
  await db.sessions.update(session.id, (s) => ({ ...s, chain: { ...s.chain, subscriptionPlanId: planId } }));
  return planId;
}

/* ── Payment links open sessions ────────────────────────────────────────── */

/**
 * A payment link is a session factory: opening one creates a fresh session
 * with the link's terms, a one-hour expiry and a unique order id, so a
 * reusable link can be paid any number of times and each payment settles
 * exactly once.
 */
export async function openLink(linkId: string): Promise<CheckoutSessionRecord> {
  const db = getDb();
  const config = getConfig();
  const link: LinkRecord | null = await db.links.get(linkId);
  if (!link || link.sample) throw new HttpError(404, "not_found", "This payment link doesn't exist.");
  if (link.status === "used") throw new HttpError(410, "link_used", "This payment link has already been paid.");
  if (link.status === "expired" || (link.expiresAt && Date.parse(link.expiresAt) <= Date.now())) {
    throw new HttpError(410, "link_expired", "This payment link has expired.");
  }
  const merchant = await db.merchants.get(link.merchantId);
  if (!merchant) throw new HttpError(404, "not_found", "This payment link doesn't exist.");
  // Opening a link pins a price on chain (one relayer transaction): bounded per link as well as per IP.
  consume(LIMITS.linkOpen, link.id);
  const modes = link.modes.filter((m) => m !== "subscribe" || link.usage === "reusable");
  return createSession(
    merchant,
    {
      amountCents: link.amountCents,
      description: link.description,
      lineItems: [],
      modes: modes.length ? modes : ["now"],
      subscription: modes.includes("subscribe") ? { interval: "month", intervalCount: 1 } : null,
      successUrl: `${config.checkoutOrigin}/pay/{CHECKOUT_SESSION_ID}`,
      cancelUrl: null,
      orderId: `link-${link.id}-${newId("o", 10).slice(2)}`,
      metadata: { linkId: link.id },
    },
    { linkId: link.id, ttlSeconds: 3600 },
  );
}
