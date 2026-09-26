import type { WebhookEvent } from "polarispay-sdk";

import { decimalToCents, formatUsd } from "@/lib/money";

import type { Order, OrderPlan, ReceivedEvent } from "./types";

/**
 * How a verified Polaris event changes an order. Pure: the webhook route
 * verifies the signature, loads the order, calls this, and saves the result.
 *
 * An order is paid when Polaris says the store has the money:
 * - payment.succeeded   Pay now, or a direct wallet payment
 * - plan.opened         Pay in 4: the store is paid the principal in full at opening
 * - subscription.charged, period 1: the first month of a subscription
 * Each must match the order (amount, currency) or the order goes to review.
 *
 * - "applied":   the order changed, or the event was recorded as history.
 * - "duplicate": this event id was already applied; at-least-once delivery
 *                means repeats are normal and must change nothing.
 * - "flagged":   genuine but doesn't match the order (the wrong amount, say),
 *                so the order goes to needs_review instead of shipping.
 * - "retry":     the event arrived before the one it depends on (an
 *                instalment before its plan). Answer non-2xx so Polaris
 *                redelivers it later; nothing is recorded.
 */
export type ApplyOutcome = "applied" | "duplicate" | "flagged" | "retry";

export type ApplyResult = { outcome: ApplyOutcome; order: Order; reason?: string };

/** Amounts arrive with up to 6 decimals (AUSD's precision); orders are in cents. */
function cents(amount: unknown): number | null {
  if (typeof amount !== "string") return null;
  const exact = decimalToCents(amount);
  if (exact !== null) return exact;
  const m = /^(\d+)\.(\d{2})(\d{1,4})$/.exec(amount);
  if (!m) return null;
  return Number(m[3]!.replace(/0+$/, "")) === 0 ? Number(m[1]) * 100 + Number(m[2]) : null;
}

export function applyEvent(order: Order, event: WebhookEvent, now: Date = new Date()): ApplyResult {
  if (order.events.some((e) => e.id === event.id)) return { outcome: "duplicate", order };

  const next: Order = structuredClone(order);
  const at = now.toISOString();
  const record = (summary: string, outcome: ReceivedEvent["outcome"] = "applied"): ApplyResult => {
    next.events.push({ id: event.id, type: event.type, createdAt: event.createdAt, receivedAt: at, summary, outcome });
    next.updatedAt = at;
    return { outcome, order: next };
  };
  const flag = (reason: string): ApplyResult => {
    if (next.status !== "paid") {
      next.status = "needs_review";
      next.statusReason = reason;
    }
    return { ...record(reason, "flagged"), reason };
  };
  const retry = (reason: string): ApplyResult => ({ outcome: "retry", order, reason });

  switch (event.type) {
    case "payment.succeeded": {
      const data = event.data;
      const amount = cents(data.amount);
      if (data.currency !== "USD") return flag(`Payment arrived in ${String(data.currency)}, not USD.`);
      if (amount !== order.total) {
        return flag(`Payment of ${amount === null ? data.amount : formatUsd(amount)} doesn't match the order total of ${formatUsd(order.total)}.`);
      }
      // A session payment carries its session; a direct wallet payment has none.
      const direct = order.payment.method === "wallet" || !data.sessionId;
      markPaid(next, at, direct ? "direct" : "now", { payer: data.payer, txHash: data.txHash, paymentId: data.paymentId });
      return record(`${formatUsd(amount)} paid · ${direct ? "direct wallet payment" : "Pay now"}`);
    }

    case "plan.opened": {
      const data = event.data;
      const principal = cents(data.principal);
      if (data.currency !== "USD") return flag(`A plan in ${String(data.currency)}, not USD.`);
      if (principal !== order.total) {
        return flag(`A plan for ${data.principal} doesn't match the order total of ${formatUsd(order.total)}.`);
      }
      const opened = new Date(event.createdAt).getTime();
      next.plan = {
        planId: data.planId,
        intervalSeconds: data.intervalSeconds,
        status: "active",
        installments: data.schedule.map((inst) => {
          // The first payment is taken at checkout, when the plan opens.
          const takenAtCheckout = inst.index === 1 && new Date(inst.dueAt).getTime() <= opened + 60_000;
          return {
            index: inst.index,
            amount: cents(inst.amount) ?? 0,
            dueAt: inst.dueAt,
            status: takenAtCheckout ? "paid" : "upcoming",
            paidAt: takenAtCheckout ? event.createdAt : null,
          };
        }),
      };
      markPaid(next, at, "later", { payer: data.borrower, txHash: data.txHash });
      return record(`Pay in 4 plan opened · ${formatUsd(principal)} paid to Halcyon · ${data.installments} payments of ${formatUsd(next.plan.installments[0]?.amount ?? 0)}`);
    }

    case "installment.collected":
    case "installment.failed": {
      const plan = next.plan;
      if (!plan || plan.planId !== event.data.planId) return retry("The plan for this instalment hasn't arrived yet.");
      const inst = plan.installments.find((i) => i.index === event.data.installment);
      if (!inst) return retry(`Instalment ${event.data.installment} isn't on the plan.`);
      if (event.type === "installment.collected") {
        inst.status = "paid";
        inst.paidAt = event.createdAt;
        plan.status = plan.installments.every((i) => i.status === "paid") ? "completed" : "active";
        return record(`Instalment ${inst.index} of ${plan.installments.length} collected · ${formatUsd(inst.amount)}`);
      }
      inst.status = "failed";
      plan.status = "past_due";
      const why = event.data.reason === "insufficient_funds" ? "not enough in the account" : event.data.reason.replace("_", " ");
      return record(`Instalment ${inst.index} of ${plan.installments.length} missed · ${why} · attempt ${event.data.attempt}`);
    }

    case "plan.completed": {
      if (!next.plan || next.plan.planId !== event.data.planId) return retry("The plan hasn't arrived yet.");
      closePlan(next.plan, event.createdAt);
      return record("Pay in 4 plan completed");
    }

    case "plan.liquidated": {
      if (!next.plan || next.plan.planId !== event.data.planId) return retry("The plan hasn't arrived yet.");
      // The store was paid in full at checkout; a defaulted plan is Polaris's loss, not ours.
      next.plan.status = "liquidated";
      return record("Pay in 4 plan closed by Polaris after missed payments. The order stays paid.");
    }

    case "subscription.charged": {
      const data = event.data;
      const amount = cents(data.amount);
      if (amount !== order.total) {
        return flag(`A subscription charge of ${data.amount} doesn't match ${formatUsd(order.total)} a period.`);
      }
      next.subscription = {
        subscriptionId: data.subscriptionId,
        interval: "month",
        intervalCount: 1,
        nextChargeAt: data.nextChargeAt,
        periodsCharged: Math.max(next.subscription?.periodsCharged ?? 0, data.period),
        status: next.subscription?.status === "canceled" ? "canceled" : "active",
        canceledAt: next.subscription?.canceledAt,
      };
      if (data.period === 1) markPaid(next, at, "subscribe", { payer: data.subscriber, txHash: data.txHash });
      return record(`Subscription charged · month ${data.period} · ${formatUsd(amount)}`);
    }

    case "subscription.canceled": {
      if (!next.subscription || next.subscription.subscriptionId !== event.data.subscriptionId) {
        return retry("The subscription hasn't arrived yet.");
      }
      next.subscription.status = "canceled";
      next.subscription.canceledAt = event.createdAt;
      return record(`Subscription canceled by the ${event.data.canceledBy}`);
    }

    case "payout.paid":
      // Not about an order. The route handles merchant-level events before this.
      return record("Payout sent to the store's account");
  }
}

function markPaid(
  order: Order,
  at: string,
  mode: Order["payment"]["mode"],
  details: { payer?: string; txHash?: string; paymentId?: string },
) {
  if (order.status === "paid") return;
  order.status = "paid";
  delete order.statusReason;
  order.payment.paidAt = at;
  order.payment.mode = mode;
  if (details.payer) order.payment.payer = details.payer;
  if (details.txHash) order.payment.txHash = details.txHash;
  if (details.paymentId) order.payment.paymentId = details.paymentId;
}

function closePlan(plan: OrderPlan, at: string) {
  plan.status = "completed";
  for (const inst of plan.installments) {
    if (inst.status !== "paid") {
      inst.status = "paid";
      inst.paidAt = at;
    }
  }
}

/** The order an event is about: the orderId the shop gave the session or pay(), then metadata. */
export function orderIdForEvent(event: WebhookEvent): string | null {
  const data = event.data as { orderId?: unknown; metadata?: Record<string, unknown> };
  if (typeof data.orderId === "string" && data.orderId) return data.orderId;
  const fromMetadata = data.metadata?.orderId;
  return typeof fromMetadata === "string" && fromMetadata ? fromMetadata : null;
}
