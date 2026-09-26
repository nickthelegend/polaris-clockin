import { randomBytes, randomInt } from "node:crypto";

import type { CheckoutSession, WebhookEvent as PolarisEvent } from "polarispay-sdk";

import { fingerprint, type PricedCheckout } from "./checkout-request";
import { orderStore, type OrderStore } from "./store";
import { applyEvent, orderIdForEvent, type ApplyOutcome } from "./transitions";
import type { Order, SdkCall } from "./types";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Order ids double as the on-chain order id for direct wallet payments, so
 * they must be unguessable: a guessable id could be paid (for a cent) before
 * the buyer pays it. 20 base32 characters is 100 bits.
 */
export function newOrderId(): string {
  const bytes = randomBytes(20);
  let id = "hc_";
  for (const byte of bytes) id += BASE32[byte % 32];
  return id;
}

/** What the buyer reads: HC-40218. */
export function newOrderNumber(): string {
  return `HC-${randomInt(10_000, 99_999)}`;
}

export type CreateOrderResult = { ok: true; order: Order; reused: boolean } | { ok: false; conflict: true };

/**
 * Create the order for a checkout, once per idempotency key. The same key
 * with the same request returns the same order (a double click, a retry after
 * a dropped response); the same key with a different request is a conflict.
 */
export function createOrder(
  checkout: PricedCheckout,
  idempotencyKey: string | null,
  store: OrderStore = orderStore(),
  now: Date = new Date(),
): Promise<CreateOrderResult> {
  return store.update((data) => {
    const print = fingerprint(checkout);
    if (idempotencyKey) {
      const prior = data.idempotency[idempotencyKey];
      if (prior) {
        if (prior.fingerprint !== print) return { ok: false as const, conflict: true as const };
        const existing = data.orders[prior.orderId];
        if (existing) return { ok: true as const, order: existing, reused: true };
      }
    }
    const at = now.toISOString();
    const order: Order = {
      id: newOrderId(),
      number: newOrderNumber(),
      createdAt: at,
      updatedAt: at,
      status: "awaiting_payment",
      kind: checkout.kind,
      lines: checkout.lines,
      subtotal: checkout.subtotal,
      shipping: checkout.shipping,
      total: checkout.total,
      contact: checkout.contact,
      address: checkout.address,
      payment: {
        method: checkout.payment.method,
        ...(checkout.payment.method === "polaris" ? { requestedMode: checkout.payment.mode } : {}),
        sessionAttempt: 0,
      },
      events: [],
      sdkLog: [],
    };
    data.orders[order.id] = order;
    if (idempotencyKey) data.idempotency[idempotencyKey] = { orderId: order.id, fingerprint: print, createdAt: at };
    return { ok: true as const, order, reused: false };
  });
}

export async function getOrder(id: string, store: OrderStore = orderStore()): Promise<Order | null> {
  const data = await store.read();
  return data.orders[id] ?? null;
}

/** An open session that hasn't expired can be reopened instead of creating another. */
export function reusableSession(order: Order, now: Date = new Date()): { id: string; url: string } | null {
  const { sessionId, sessionUrl, sessionExpiresAt } = order.payment;
  if (!sessionId || !sessionUrl || !sessionExpiresAt) return null;
  return new Date(sessionExpiresAt).getTime() - now.getTime() > 60_000 ? { id: sessionId, url: sessionUrl } : null;
}

/** Bump the attempt counter before creating a new session, so its idempotency key is new. */
export function nextSessionAttempt(orderId: string, store: OrderStore = orderStore()): Promise<Order | null> {
  return store.update((data) => {
    const order = data.orders[orderId];
    if (!order) return null;
    if (order.payment.sessionId) order.payment.sessionAttempt += 1;
    return order;
  });
}

export function attachSession(orderId: string, session: CheckoutSession, log: SdkCall, store: OrderStore = orderStore()) {
  return store.update((data) => {
    const order = data.orders[orderId];
    if (!order) return null;
    order.payment.sessionId = session.id;
    order.payment.sessionUrl = session.url;
    order.payment.sessionExpiresAt = session.expiresAt;
    order.sdkLog.push(log);
    order.updatedAt = new Date().toISOString();
    return order;
  });
}

export function appendSdkLog(orderId: string, entries: SdkCall[], store: OrderStore = orderStore()) {
  return store.update((data) => {
    const order = data.orders[orderId];
    if (!order) return null;
    order.sdkLog.push(...entries);
    order.sdkLog = order.sdkLog.slice(-60);
    return order;
  });
}

export type WebhookOutcome = ApplyOutcome | "ignored";

/**
 * Apply one verified event. The status code is what the webhook route
 * answers: 2xx for anything Polaris shouldn't send again (including repeats
 * and events about unknown orders), 409 for an event that arrived before the
 * one it depends on, so Polaris retries it.
 */
export function recordEvent(
  event: PolarisEvent,
  store: OrderStore = orderStore(),
  now: Date = new Date(),
): Promise<{ status: number; outcome: WebhookOutcome; orderId: string | null; reason?: string }> {
  return store.update((data) => {
    if (data.events[event.id]) {
      return { status: 200, outcome: "duplicate" as const, orderId: data.events[event.id]!.orderId };
    }
    const remember = (orderId: string | null) => {
      data.events[event.id] = { type: event.type, receivedAt: now.toISOString(), orderId };
    };
    if (event.type === "payout.paid") {
      remember(null);
      return { status: 200, outcome: "ignored" as const, orderId: null };
    }

    let orderId = orderIdForEvent(event);
    if (!orderId || !data.orders[orderId]) {
      // Fall back to what the store saw earlier: the session, the plan, the subscription.
      const ref = event.data as { sessionId?: string | null; planId?: string; subscriptionId?: string };
      const found = Object.values(data.orders).find(
        (o) =>
          (ref.sessionId && o.payment.sessionId === ref.sessionId) ||
          (ref.planId && o.plan?.planId === ref.planId) ||
          (ref.subscriptionId && o.subscription?.subscriptionId === ref.subscriptionId),
      );
      orderId = found?.id ?? null;
    }
    const order = orderId ? data.orders[orderId] : undefined;
    if (!order) {
      remember(null);
      return { status: 200, outcome: "ignored" as const, orderId: null, reason: "No order matches this event." };
    }

    const result = applyEvent(order, event, now);
    if (result.outcome === "retry") return { status: 409, outcome: "retry" as const, orderId: order.id, reason: result.reason };
    data.orders[order.id] = result.order;
    remember(order.id);
    return { status: 200, outcome: result.outcome, orderId: order.id, reason: result.reason };
  });
}
