import "server-only";

import {
  assertDeliverableUrl,
  keyHint,
  newId,
  newPublishableKey,
  newSecretKey,
  newWebhookSecret,
  randomBase62,
  WebhookUrlRefused,
  type ApiKeyRecord,
  type LinkRecord,
  type MerchantRecord,
  type PaymentRecord,
  type PayoutRecord,
  type PlanRecord,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
} from "@polaris/db";

import { isToday, money } from "@/lib/data/format";
import { seedMerchantBook, type SampleBook } from "@/lib/data/placeholder";
import type {
  ApiKey,
  AutoPayouts,
  AutoPayoutsInput,
  CollectorStatus,
  CreateApiKeyInput,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  CreateLinkInput,
  CreateWebhookInput,
  Merchant,
  Overview,
  Payment,
  PaymentLink,
  Payout,
  PayoutsState,
  Plan,
  WebhookDelivery,
  WebhookEndpoint,
  WebhooksState,
  WithdrawInput,
} from "@/lib/data/types";
import { hashKey, requireWallet, type AuthedMerchant } from "./auth";
import { unitsToCents } from "./chain/money";
import { getDb } from "./db";
import { checkoutUrl, getConfig } from "./env";
import { HttpError } from "./http";
import { ensureMerchant, toMerchant } from "./merchants";
import { refreshRegistration } from "./onboarding";
import { createPayoutPolicy } from "./payout-policy";
import { nextRunAt, runPayoutSweep, walletBalanceUnits, withdrawSigned } from "./payouts/payouts";
import { dispatchDue } from "./webhooks/dispatcher";
import { emitEvent } from "./webhooks/events";

/**
 * What each dashboard route does once the caller is known. Route handlers are
 * thin: authenticate, validate, call one of these, respond.
 *
 * Everything shown comes from the store, which the chain fills: payments,
 * plans and payouts are written only when their events are ingested. A
 * merchant created while no chain is configured sees a labelled sample book
 * instead (`MerchantRecord.sample`).
 */

export async function merchantFor(auth: AuthedMerchant): Promise<Merchant> {
  // A registration still in flight is checked against the registry here, so
  // it never sits at "submitted" after the relay's receipt wait ran out.
  return toMerchant(await refreshRegistration(await ensureMerchant(auth)));
}

export async function updateMerchant(auth: AuthedMerchant, patch: { businessName: string }): Promise<Merchant> {
  const merchant = await ensureMerchant(auth);
  const updated = (await getDb().merchants.update(merchant.id, (m) => ({ ...m, businessName: patch.businessName }))) as MerchantRecord;
  return toMerchant(updated);
}

function sampleOf(merchant: MerchantRecord): SampleBook | null {
  return merchant.sample ? seedMerchantBook(merchant.id) : null;
}

/* ── Mapping records to what the dashboard shows ────────────────────────── */

function toPayment(p: PaymentRecord): Payment {
  const amountCents = unitsToCents(p.amountUnits);
  const feeCents = unitsToCents(p.feeUnits);
  return {
    id: p.id,
    orderId: p.orderId,
    description: p.description,
    buyer: p.payer,
    mode: p.kind === "subscription" ? "subscribe" : p.kind,
    status: "succeeded",
    amountCents,
    feeCents,
    netCents: amountCents - feeCents,
    linkId: p.linkId,
    txHash: p.txHash,
    createdAt: p.createdAt,
  };
}

function nextDue(p: PlanRecord): string | null {
  if (p.state === "repaid" || p.state === "written_off" || p.installmentsPaid >= p.installments) return null;
  return new Date((p.startedAt + (p.installmentsPaid + 1) * p.intervalSeconds) * 1000).toISOString();
}

function toPlan(p: PlanRecord): Plan {
  const total = BigInt(p.totalOwedUnits);
  const repaid = BigInt(p.repaidUnits);
  return {
    id: p.id,
    orderId: p.orderId,
    description: p.description,
    buyer: p.borrower,
    principalCents: unitsToCents(p.principalUnits),
    totalCents: unitsToCents(total),
    outstandingCents: p.state === "repaid" ? 0 : unitsToCents(total > repaid ? total - repaid : 0n),
    installmentCount: p.installments,
    installmentsPaid: p.installmentsPaid,
    state: p.state,
    attempts: p.attempts,
    nextDueAt: nextDue(p),
    openedAt: p.createdAt,
  };
}

function toPayout(p: PayoutRecord): Payout {
  return {
    id: p.id,
    kind: p.kind,
    status: p.state === "paid" ? "paid" : p.state === "failed" ? "failed" : "queued",
    amountCents: unitsToCents(p.amountUnits),
    destination: p.destination,
    signed: !p.sample,
    txHash: p.txHash,
    createdAt: p.createdAt,
  };
}

function toLink(l: LinkRecord): PaymentLink {
  const expired = l.status === "active" && l.expiresAt !== null && Date.parse(l.expiresAt) <= Date.now();
  return {
    id: l.id,
    // From the current checkout origin, so a link made before it was set
    // (or moved) still opens; "" while none is configured.
    url: checkoutUrl(l.id) ?? l.url,
    amountCents: l.amountCents,
    description: l.description,
    modes: l.modes,
    usage: l.usage,
    expiresAt: l.expiresAt,
    status: expired ? "expired" : l.status,
    paymentsCount: l.paymentsCount,
    collectedCents: l.collectedCents,
    createdAt: l.createdAt,
  };
}

function toAutoPayouts(m: MerchantRecord): AutoPayouts {
  const a = m.autoPayouts;
  return { enabled: a.enabled, payoutAddress: a.payoutAddress, policyId: a.policyId, hourUtc: a.hourUtc, nextRunAt: a.nextRunAt };
}

const newestFirst = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function listPayments(auth: AuthedMerchant): Promise<Payment[]> {
  const merchant = await ensureMerchant(auth);
  const real = (await getDb().payments.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc", limit: 500 })).map(toPayment);
  return [...real, ...(sampleOf(merchant)?.payments ?? [])].sort(newestFirst);
}

export async function listPlans(auth: AuthedMerchant): Promise<Plan[]> {
  const merchant = await ensureMerchant(auth);
  const real = (await getDb().plans.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc", limit: 500 })).map(toPlan);
  return [...real, ...(sampleOf(merchant)?.plans ?? [])].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
}

async function balanceCents(merchant: MerchantRecord): Promise<number> {
  if (merchant.sample) return merchant.sampleBalanceCents;
  if (!merchant.walletAddress || !getConfig().chain) return 0;
  try {
    return unitsToCents(await walletBalanceUnits(merchant.walletAddress));
  } catch {
    return 0;
  }
}

async function collectorStatus(merchant: MerchantRecord): Promise<CollectorStatus> {
  const sample = sampleOf(merchant);
  if (sample) return sample.collector;
  const run = await getDb().collectorRuns.get("cre");
  if (!run?.lastRunAt) return { state: "stopped", lastPassAt: null, runner: "cre" };
  const age = Date.now() - Date.parse(run.lastRunAt);
  return { state: age < 5 * 60_000 ? "running" : age < 3_600_000 ? "degraded" : "stopped", lastPassAt: run.lastRunAt, runner: "cre" };
}

export async function getOverview(auth: AuthedMerchant): Promise<Overview> {
  const merchant = await refreshRegistration(await ensureMerchant(auth));
  const [payments, plans, balance, collector] = await Promise.all([listPayments(auth), listPlans(auth), balanceCents(merchant), collectorStatus(merchant)]);

  const now = Date.now();
  const today = payments.filter((p) => isToday(p.createdAt, now));
  const succeededToday = today.filter((p) => p.status === "succeeded");

  let collectingCents = 0;
  let collectingPlans = 0;
  let atRiskCents = 0;
  let atRiskPlans = 0;
  for (const plan of plans) {
    if (plan.state === "collecting") {
      collectingCents += plan.outstandingCents;
      collectingPlans += 1;
    } else if (plan.state === "dunning") {
      atRiskCents += plan.outstandingCents;
      atRiskPlans += 1;
    }
  }

  // Instalments collected in the last seven days, and the on-time rate over those that came due.
  const WEEK = 7 * 86_400_000;
  const records = merchant.sample ? [] : await getDb().plans.find({ merchantId: merchant.id }, { limit: 500 });
  let collectedThisWeekCents = 0;
  let cameDue = 0;
  let collected = 0;
  for (const p of records) {
    const each = Math.floor(unitsToCents(p.totalOwedUnits) / p.installments);
    for (let k = 1; k <= p.installmentsPaid; k++) {
      const dueAt = (p.startedAt + k * p.intervalSeconds) * 1000;
      if (dueAt > now - WEEK) collectedThisWeekCents += each;
    }
    const due = Math.min(p.installments, Math.max(0, Math.floor((now / 1000 - p.startedAt) / p.intervalSeconds)));
    cameDue += due;
    collected += Math.min(p.installmentsPaid, due);
  }
  const sample = sampleOf(merchant);
  if (sample) {
    for (const plan of sample.plans) {
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
  }
  const collectionRate = cameDue === 0 ? null : Math.round((collected / cameDue) * 1000) / 10;

  return {
    merchant: toMerchant(merchant),
    balanceCents: balance,
    today: {
      count: succeededToday.length,
      grossCents: succeededToday.reduce((sum, p) => sum + p.amountCents, 0),
      payments: today.slice(0, 6),
    },
    exposure: {
      outstandingCents: collectingCents + atRiskCents,
      collectingCents,
      collectingPlans,
      atRiskCents,
      atRiskPlans,
      collectedThisWeekCents,
      collectionRate,
    },
    collector,
    autoPayouts: toAutoPayouts(merchant),
    sample: merchant.sample,
  };
}

/* ── Links ──────────────────────────────────────────────────────────────── */

const MAX_LINKS = 500;

export async function createLink(auth: AuthedMerchant, input: CreateLinkInput): Promise<PaymentLink> {
  const merchant = await ensureMerchant(auth);
  // Count the active links only: turned-off ones don't hold a place.
  const active = await getDb().links.count({ merchantId: merchant.id, status: "active" });
  if (active >= MAX_LINKS) {
    throw new HttpError(409, "limit_reached", `You can have up to ${MAX_LINKS} active links. Turn off one you no longer use.`);
  }
  const id = `pl_${randomBase62(14)}`;
  const record: LinkRecord = {
    id,
    merchantId: merchant.id,
    url: checkoutUrl(id) ?? "",
    amountCents: input.amountCents,
    description: input.description,
    modes: input.modes,
    usage: input.usage,
    expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3_600_000).toISOString() : null,
    status: "active",
    paymentsCount: 0,
    collectedCents: 0,
    createdAt: new Date().toISOString(),
  };
  return toLink(await getDb().links.insert(record));
}

/** Turn a link off. Links are never deleted: payments point at them. */
export async function deactivateLink(auth: AuthedMerchant, linkId: string): Promise<PaymentLink> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const link = await db.links.get(linkId);
  if (!link || link.merchantId !== merchant.id) {
    if (sampleOf(merchant)?.links.some((l) => l.id === linkId)) {
      throw new HttpError(409, "sample_data", "Sample links can't be changed. Your own links can.");
    }
    throw new HttpError(404, "not_found", "That link doesn't exist.");
  }
  if (link.status === "inactive") return toLink(link);
  return toLink((await db.links.update(linkId, (l) => ({ ...l, status: "inactive" }))) as LinkRecord);
}

export async function listLinks(auth: AuthedMerchant): Promise<PaymentLink[]> {
  const merchant = await ensureMerchant(auth);
  const real = (await getDb().links.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc", limit: 200 })).map(toLink);
  return [...real, ...(sampleOf(merchant)?.links ?? [])].sort(newestFirst);
}

/* ── Payouts ────────────────────────────────────────────────────────────── */

export async function getPayouts(auth: AuthedMerchant): Promise<PayoutsState> {
  const merchant = await ensureMerchant(auth);
  const rows = await getDb().payouts.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc", limit: 200 });
  // Withdrawals against a sample balance are sample rows too.
  const real = rows.map((p) => (p.sample ? { ...toPayout(p), sample: true } : toPayout(p))).filter((p) => merchant.sample || !p.sample);
  return {
    balanceCents: await balanceCents(merchant),
    walletAddress: merchant.walletAddress,
    auto: toAutoPayouts(merchant),
    history: [...real, ...(sampleOf(merchant)?.payouts ?? [])].sort(newestFirst),
  };
}

/**
 * Withdraw to any address. With a chain configured this needs the payout
 * wallet's signed authorisation, and the relayer submits it; in sample mode
 * it is recorded against the sample balance.
 */
export async function withdraw(auth: AuthedMerchant, input: WithdrawInput): Promise<Payout> {
  const merchant = await ensureMerchant(auth);
  const wallet = requireWallet(auth);
  if (input.destination === wallet) {
    throw new HttpError(400, "invalid_request", "That's your Polaris payout account itself. Enter where the money should go.");
  }
  if (!merchant.sample) {
    if (!input.authorization) throw new HttpError(400, "signature_required", "Confirm the withdrawal with your payout account.");
    return toPayout(await withdrawSigned({ merchant, wallet, amountCents: input.amountCents, destination: input.destination, authorization: input.authorization }));
  }

  // Sample mode: debit the sample balance, atomically.
  const db = getDb();
  let available = 0;
  let ok = false;
  await db.merchants.update(merchant.id, (m) => {
    available = m.sampleBalanceCents;
    if (input.amountCents > m.sampleBalanceCents) return m;
    ok = true;
    return { ...m, sampleBalanceCents: m.sampleBalanceCents - input.amountCents };
  });
  if (!ok) throw new HttpError(400, "insufficient_balance", `You can withdraw up to ${money(available)} right now.`, { param: "amountCents" });
  const payout = await db.payouts.insert({
    id: newId("po", 16),
    merchantId: merchant.id,
    kind: "manual",
    state: "queued",
    amountUnits: (BigInt(input.amountCents) * 10_000n).toString(),
    from: wallet,
    destination: input.destination,
    authorizationNonce: null,
    txHash: null,
    error: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
    sample: true,
  });
  return toPayout(payout);
}

export async function setAutoPayouts(auth: AuthedMerchant, input: AutoPayoutsInput): Promise<AutoPayouts> {
  const merchant = await ensureMerchant(auth);
  const current = merchant.autoPayouts;

  // Turning on needs the wallet (the payout address must differ from it);
  // turning off never does.
  if (input.enabled) {
    const wallet = requireWallet(auth);
    if (input.payoutAddress && input.payoutAddress === wallet) {
      throw new HttpError(400, "invalid_request", "That's your Polaris payout account itself. Enter where the money should go.");
    }
  }
  const payoutAddress = input.payoutAddress ?? current.payoutAddress;
  let policyId = current.policyId;
  // A new destination needs a new policy: the old one names the old address.
  if (input.enabled && payoutAddress && (payoutAddress !== current.payoutAddress || !policyId)) {
    try {
      policyId = await createPayoutPolicy(merchant.id, payoutAddress);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("[payouts] policy creation failed", error);
      throw new HttpError(502, "privy_unavailable", "We couldn't set up the payout policy with Privy. Try again.");
    }
  }
  const updated = (await getDb().merchants.update(merchant.id, (m) => ({
    ...m,
    autoPayouts: {
      ...m.autoPayouts,
      enabled: input.enabled,
      payoutAddress,
      policyId,
      nextRunAt: input.enabled ? nextRunAt(m.autoPayouts.hourUtc) : null,
      lastError: null,
    },
  }))) as MerchantRecord;
  return toAutoPayouts(updated);
}

/** "Pay out now": run this merchant's automatic payout immediately. */
export async function payoutNow(auth: AuthedMerchant) {
  const merchant = await ensureMerchant(auth);
  if (!merchant.autoPayouts.enabled) throw new HttpError(409, "automatic_payouts_off", "Turn on automatic payouts first.");
  const [outcome] = await runPayoutSweep({ merchantId: merchant.id });
  return outcome ?? { merchantId: merchant.id, result: "skipped" as const, detail: "Nothing to do." };
}

/* ── API keys ───────────────────────────────────────────────────────────── */

function toApiKey(key: ApiKeyRecord): ApiKey {
  return { id: key.id, name: key.name, publishableKey: key.publishableKey, secretHint: key.secretHint, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt };
}

export async function listApiKeys(auth: AuthedMerchant): Promise<ApiKey[]> {
  const merchant = await ensureMerchant(auth);
  return (await getDb().apiKeys.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc" })).filter((k) => !k.revokedAt).map(toApiKey);
}

const MAX_KEYS = 20;

export async function createApiKey(auth: AuthedMerchant, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  if ((await listApiKeys(auth)).length >= MAX_KEYS) {
    throw new HttpError(409, "limit_reached", `You can have up to ${MAX_KEYS} keys. Remove one you no longer use.`);
  }
  const secret = newSecretKey("test");
  const stored = await db.apiKeys.insert({
    id: newId("key", 16),
    merchantId: merchant.id,
    name: input.name,
    livemode: false,
    publishableKey: newPublishableKey("test"),
    secretHint: keyHint(secret),
    secretHash: hashKey(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  });
  return { key: toApiKey(stored), secret };
}

export async function revokeApiKey(auth: AuthedMerchant, keyId: string): Promise<ApiKey> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const key = await db.apiKeys.get(keyId);
  if (!key || key.merchantId !== merchant.id || key.revokedAt) throw new HttpError(404, "not_found", "That key doesn't exist.");
  return toApiKey((await db.apiKeys.update(keyId, (k) => ({ ...k, revokedAt: new Date().toISOString() }))) as ApiKeyRecord);
}

/* ── Webhooks ───────────────────────────────────────────────────────────── */

function toEndpoint(e: WebhookEndpointRecord): WebhookEndpoint {
  return { id: e.id, url: e.url, events: e.events, secretHint: e.secretHint, createdAt: e.createdAt };
}

export function toDelivery(d: WebhookDeliveryRecord): WebhookDelivery {
  const last = d.attempts[d.attempts.length - 1];
  return {
    id: d.id,
    endpointId: d.endpointId,
    url: d.url,
    event: d.type,
    eventId: d.eventId,
    status: last?.status ?? null,
    durationMs: last?.durationMs ?? null,
    attempt: d.attempts.length,
    test: d.test,
    simulated: false,
    request: d.request ?? { headers: {}, body: "" },
    createdAt: d.createdAt,
    state: d.state,
    nextAttemptAt: d.state === "pending" && d.nextAttemptAtMs !== null ? new Date(d.nextAttemptAtMs).toISOString() : null,
    attempts: d.attempts,
  };
}

export async function listWebhooks(auth: AuthedMerchant): Promise<WebhooksState> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const [endpoints, deliveries] = await Promise.all([
    db.webhookEndpoints.find({ merchantId: merchant.id }, { orderBy: "createdAt" }),
    db.webhookDeliveries.find({ merchantId: merchant.id }, { orderBy: "createdAt", direction: "desc", limit: 100 }),
  ]);
  return { endpoints: endpoints.filter((e) => !e.disabledAt).map(toEndpoint), deliveries: deliveries.map(toDelivery) };
}

const MAX_ENDPOINTS = 10;

export async function createWebhook(auth: AuthedMerchant, input: CreateWebhookInput): Promise<CreatedWebhookEndpoint> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  try {
    assertDeliverableUrl(input.url, { allowPrivate: getConfig().webhooks.allowPrivate });
  } catch (error) {
    if (error instanceof WebhookUrlRefused) throw new HttpError(400, "invalid_request", error.message, { param: "url" });
    throw error;
  }
  const existing = (await db.webhookEndpoints.find({ merchantId: merchant.id })).filter((e) => !e.disabledAt);
  if (existing.length >= MAX_ENDPOINTS) throw new HttpError(409, "limit_reached", `You can have up to ${MAX_ENDPOINTS} endpoints.`);
  if (existing.some((e) => e.url === input.url)) throw new HttpError(409, "duplicate", "That endpoint is already registered.");
  const secret = newWebhookSecret();
  const stored = await db.webhookEndpoints.insert({
    id: newId("we", 16),
    merchantId: merchant.id,
    url: input.url,
    events: input.events,
    secret,
    secretHint: keyHint(secret),
    createdAt: new Date().toISOString(),
    disabledAt: null,
  });
  return { endpoint: toEndpoint(stored), secret };
}

export async function deleteWebhook(auth: AuthedMerchant, endpointId: string): Promise<WebhookEndpoint> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const endpoint = await db.webhookEndpoints.get(endpointId);
  if (!endpoint || endpoint.merchantId !== merchant.id || endpoint.disabledAt) throw new HttpError(404, "not_found", "That endpoint doesn't exist.");
  return toEndpoint((await db.webhookEndpoints.update(endpointId, (e) => ({ ...e, disabledAt: new Date().toISOString() }))) as WebhookEndpointRecord);
}

/**
 * Send a signed test `payment.succeeded` to one endpoint, exactly as a live
 * one is sent (same headers, same signature, `livemode: false`), and return
 * the delivery with its result.
 */
export async function sendTestEvent(auth: AuthedMerchant, endpointId: string): Promise<WebhookDelivery> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const endpoint = await db.webhookEndpoints.get(endpointId);
  if (!endpoint || endpoint.merchantId !== merchant.id || endpoint.disabledAt) throw new HttpError(404, "not_found", "That endpoint doesn't exist.");
  const chainId = getConfig().chain?.id ?? 10143;
  const orderId = `ord_test_${randomBase62(8)}`;
  const { deliveries } = await emitEvent({
    merchant,
    type: "payment.succeeded",
    endpointId,
    data: {
      orderId,
      sessionId: null,
      metadata: { test: "true" },
      paymentId: `0x${"0".repeat(63)}1`,
      mode: "now",
      merchant: merchant.walletAddress ?? `0x${"0".repeat(40)}`,
      payer: `0x${"0".repeat(39)}1`,
      amount: "200.00",
      fee: "1.00",
      currency: "USD",
      txHash: `0x${"0".repeat(64)}`,
      chainId,
    },
  });
  const delivery = deliveries[0];
  if (!delivery) throw new HttpError(500, "internal", "The test event couldn't be queued.");
  await dispatchDue({ ids: [delivery.id] });
  return toDelivery((await db.webhookDeliveries.get(delivery.id)) as WebhookDeliveryRecord);
}

/** Retry a delivery now, whatever its schedule says. */
export async function retryDelivery(auth: AuthedMerchant, deliveryId: string): Promise<WebhookDelivery> {
  const merchant = await ensureMerchant(auth);
  const db = getDb();
  const delivery = await db.webhookDeliveries.get(deliveryId);
  if (!delivery || delivery.merchantId !== merchant.id) throw new HttpError(404, "not_found", "That delivery doesn't exist.");
  if (delivery.state === "delivering") throw new HttpError(409, "in_progress", "That delivery is being sent right now.");
  await db.webhookDeliveries.update(deliveryId, (d) => ({ ...d, state: "pending", nextAttemptAtMs: Date.now(), lockedUntilMs: 0 }));
  await dispatchDue({ ids: [deliveryId] });
  return toDelivery((await db.webhookDeliveries.get(deliveryId)) as WebhookDeliveryRecord);
}
