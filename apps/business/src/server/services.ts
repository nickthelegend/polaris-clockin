import "server-only";

import { randomUUID } from "node:crypto";
import { verifyTypedData } from "viem";

import {
  ausdDomain,
  AUTHORIZATION_TTL_SECONDS,
  CENTS_TO_AUSD_UNITS,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "@/lib/chain";
import { isToday } from "@/lib/data/format";
import { linkUrl } from "@/lib/data/placeholder";
import type {
  ApiKey,
  AutoPayouts,
  AutoPayoutsInput,
  CreateApiKeyInput,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  CreateLinkInput,
  CreateWebhookInput,
  Merchant,
  Overview,
  PaymentLink,
  Payout,
  PayoutsState,
  WebhookDelivery,
  WebhookEndpoint,
  WebhooksState,
  WithdrawInput,
} from "@/lib/data/types";
import { requireWallet, type AuthedMerchant } from "./auth";
import { HttpError } from "./http";
import { createPayoutPolicy } from "./payout-policy";
import {
  hashSecret,
  hint,
  newId,
  newPublishableKey,
  newSecretKey,
  newWebhookSecret,
  randomBase62,
  SECRET_PREFIX,
  signWebhook,
  WEBHOOK_SECRET_PREFIX,
} from "./secrets";
import { getStore, InsufficientBalance, type StoredApiKey, type StoredWebhook } from "./store";

/**
 * What each route does, once the caller is known. Route handlers are thin:
 * authenticate, validate, call one of these, respond.
 */

const WEEK = 7 * 86_400_000;

export async function merchantFor(auth: AuthedMerchant): Promise<Merchant> {
  return getStore().ensureMerchant({ id: auth.userId, walletAddress: auth.walletAddress, email: auth.email });
}

/* ── Overview ───────────────────────────────────────────────────────────── */

export async function getOverview(auth: AuthedMerchant): Promise<Overview> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const [payments, plans, balanceCents, collector, autoPayouts] = await Promise.all([
    store.listPayments(merchant.id),
    store.listPlans(merchant.id),
    store.getBalance(merchant.id),
    store.getCollector(merchant.id),
    store.getAutoPayouts(merchant.id),
  ]);

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

  // An instalment is collected at each due date that has passed and was paid.
  let collectedThisWeekCents = 0;
  let cameDue = 0;
  let collected = 0;
  for (const plan of plans) {
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
  // Null until something has come due: an untested book is not a perfect one.
  const collectionRate = cameDue === 0 ? null : Math.round((collected / cameDue) * 1000) / 10;

  return {
    merchant,
    balanceCents,
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
    autoPayouts,
    sample: true,
  };
}

/* ── Links ──────────────────────────────────────────────────────────────── */

export async function createLink(auth: AuthedMerchant, input: CreateLinkInput): Promise<PaymentLink> {
  const merchant = await merchantFor(auth);
  const id = randomBase62(10);
  const link: PaymentLink = {
    id,
    url: linkUrl(id),
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
  return getStore().insertLink(merchant.id, link);
}

export async function listLinks(auth: AuthedMerchant): Promise<PaymentLink[]> {
  const merchant = await merchantFor(auth);
  const now = Date.now();
  // Expiry is a property of time, not of a write: compute it on read.
  return (await getStore().listLinks(merchant.id)).map((link) =>
    link.status === "active" && link.expiresAt && new Date(link.expiresAt).getTime() <= now
      ? { ...link, status: "expired" as const }
      : link,
  );
}

/* ── Payouts ────────────────────────────────────────────────────────────── */

export async function getPayouts(auth: AuthedMerchant): Promise<PayoutsState> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const [balanceCents, auto, history] = await Promise.all([
    store.getBalance(merchant.id),
    store.getAutoPayouts(merchant.id),
    store.listPayouts(merchant.id),
  ]);
  return { balanceCents, walletAddress: merchant.walletAddress, auto, history };
}

/**
 * Withdraw to any address.
 *
 * When AUSD is configured, the request must carry an ERC-3009
 * `TransferWithAuthorization` signed by the merchant's own embedded wallet: we
 * rebuild the typed data from the amount and destination in the request and
 * the wallet Privy told us about, and check the signature recovers to that
 * wallet. The relayer (not built yet) submits it, so the merchant never needs
 * MON. Without AUSD configured, the payout is recorded as sample data.
 */
export async function withdraw(auth: AuthedMerchant, input: WithdrawInput): Promise<Payout> {
  const merchant = await merchantFor(auth);
  const wallet = requireWallet(auth);
  if (input.destination === wallet) {
    throw new HttpError(400, "invalid_request", "That's your Polaris payout account itself. Enter where the money should go.");
  }

  const domain = ausdDomain();
  let signed = false;
  if (domain) {
    const authz = input.authorization;
    if (!authz) throw new HttpError(400, "signature_required", "Confirm the withdrawal with your payout account.");

    const now = Math.floor(Date.now() / 1000);
    const validBefore = Number(authz.validBefore);
    if (validBefore <= now) throw new HttpError(400, "authorization_expired", "That confirmation expired. Try again.");
    if (validBefore > now + AUTHORIZATION_TTL_SECONDS + 60) {
      throw new HttpError(400, "invalid_request", "That confirmation is valid for too long. Try again.");
    }

    const valid = await verifyTypedData({
      address: wallet,
      domain,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: wallet,
        to: input.destination,
        value: BigInt(input.amountCents) * CENTS_TO_AUSD_UNITS,
        validAfter: BigInt(authz.validAfter),
        validBefore: BigInt(authz.validBefore),
        nonce: authz.nonce,
      },
      signature: authz.signature,
    }).catch(() => false);
    if (!valid) {
      throw new HttpError(403, "bad_signature", "That confirmation didn't come from your payout account.");
    }
    signed = true;
  }

  const payout: Payout = {
    id: newId("po", 12),
    kind: "manual",
    status: "queued",
    amountCents: input.amountCents,
    destination: input.destination,
    signed,
    txHash: null,
    createdAt: new Date().toISOString(),
  };

  try {
    return await getStore().recordPayout(merchant.id, payout);
  } catch (error) {
    if (error instanceof InsufficientBalance) {
      throw new HttpError(
        400,
        "insufficient_balance",
        `You can withdraw up to $${(error.availableCents / 100).toFixed(2)} right now.`,
      );
    }
    throw error;
  }
}

export async function setAutoPayouts(auth: AuthedMerchant, input: AutoPayoutsInput): Promise<AutoPayouts> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const wallet = requireWallet(auth);
  const current = await store.getAutoPayouts(merchant.id);

  if (input.payoutAddress && input.payoutAddress === wallet) {
    throw new HttpError(400, "invalid_request", "That's your Polaris payout account itself. Enter where the money should go.");
  }

  const payoutAddress = input.payoutAddress ?? current.payoutAddress;
  let policyId = current.policyId;
  // A new destination needs a new policy: the old one names the old address.
  if (input.enabled && payoutAddress && (payoutAddress !== current.payoutAddress || !policyId)) {
    try {
      policyId = await createPayoutPolicy(merchant.id, payoutAddress);
    } catch (error) {
      console.error("[payouts] policy creation failed", error);
      throw new HttpError(502, "privy_unavailable", "We couldn't set up the payout policy with Privy. Try again.");
    }
  }

  const next = nextRun(current.hourUtc);
  return store.setAutoPayouts(merchant.id, {
    enabled: input.enabled,
    payoutAddress,
    policyId,
    hourUtc: current.hourUtc,
    nextRunAt: input.enabled ? next : null,
  });
}

function nextRun(hourUtc: number): string {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/* ── API keys ───────────────────────────────────────────────────────────── */

function publicKey(key: StoredApiKey): ApiKey {
  const { secretHash: _secretHash, ...rest } = key;
  void _secretHash;
  return rest;
}

export async function listApiKeys(auth: AuthedMerchant): Promise<ApiKey[]> {
  const merchant = await merchantFor(auth);
  return (await getStore().listApiKeys(merchant.id)).map(publicKey);
}

const MAX_KEYS = 20;

export async function createApiKey(auth: AuthedMerchant, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  if ((await store.listApiKeys(merchant.id)).length >= MAX_KEYS) {
    throw new HttpError(409, "limit_reached", `You can have up to ${MAX_KEYS} keys. Remove one you no longer use.`);
  }
  const secret = newSecretKey();
  const stored = await store.insertApiKey(merchant.id, {
    id: newId("key", 12),
    name: input.name,
    publishableKey: newPublishableKey(),
    secretHint: hint(secret, SECRET_PREFIX),
    secretHash: hashSecret(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  });
  return { key: publicKey(stored), secret };
}

/* ── Webhooks ───────────────────────────────────────────────────────────── */

function publicEndpoint(endpoint: StoredWebhook): WebhookEndpoint {
  const { secret: _secret, ...rest } = endpoint;
  void _secret;
  return rest;
}

export async function listWebhooks(auth: AuthedMerchant): Promise<WebhooksState> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const [endpoints, deliveries] = await Promise.all([store.listWebhooks(merchant.id), store.listDeliveries(merchant.id)]);
  return { endpoints: endpoints.map(publicEndpoint), deliveries };
}

const MAX_ENDPOINTS = 10;

export async function createWebhook(auth: AuthedMerchant, input: CreateWebhookInput): Promise<CreatedWebhookEndpoint> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const existing = await store.listWebhooks(merchant.id);
  if (existing.length >= MAX_ENDPOINTS) {
    throw new HttpError(409, "limit_reached", `You can have up to ${MAX_ENDPOINTS} endpoints.`);
  }
  if (existing.some((e) => e.url === input.url)) {
    throw new HttpError(409, "duplicate", "That endpoint is already registered.");
  }
  const secret = newWebhookSecret();
  const stored = await store.insertWebhook(merchant.id, {
    id: newId("we", 12),
    url: input.url,
    events: input.events,
    secretHint: hint(secret, WEBHOOK_SECRET_PREFIX),
    secret,
    createdAt: new Date().toISOString(),
  });
  return { endpoint: publicEndpoint(stored), secret };
}

/**
 * Build and sign a `payment.succeeded` test event for one endpoint, exactly as
 * a live one will be, and log it. It isn't sent yet: outbound delivery (with
 * its SSRF guard and retries) arrives with live events from the indexer.
 */
export async function sendTestEvent(auth: AuthedMerchant, endpointId: string): Promise<WebhookDelivery> {
  const store = getStore();
  const merchant = await merchantFor(auth);
  const endpoint = await store.getWebhook(merchant.id, endpointId);
  if (!endpoint) throw new HttpError(404, "not_found", "That endpoint doesn't exist.");

  const createdAt = new Date();
  const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
  const payload = {
    eventId,
    event: "payment.succeeded",
    createdAt: createdAt.toISOString(),
    merchantId: merchant.id,
    livemode: false,
    test: true,
    data: {
      orderId: `ord_test_${randomBase62(8)}`,
      amount: "200.00",
      currency: "USD",
      mode: "now",
      description: "Test event from the Polaris dashboard",
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(createdAt.getTime() / 1000);

  return store.insertDelivery(merchant.id, {
    id: newId("del", 12),
    endpointId: endpoint.id,
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
        "polaris-signature": signWebhook(endpoint.secret, body, timestamp),
        "polaris-event": "payment.succeeded",
        "polaris-delivery-attempt": "1",
      },
      body,
    },
    createdAt: createdAt.toISOString(),
  });
}
