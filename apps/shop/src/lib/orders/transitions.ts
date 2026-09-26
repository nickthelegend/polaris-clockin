import { decimalToCents, formatUsd } from "@/lib/money";
import type { PolarisEvent } from "@/lib/polaris-sdk/types";

import type { Order, OrderPlan, ReceivedEvent } from "./types";

/**
 * How a verified Polaris event changes an order. Pure: the webhook route
 * verifies the signature, loads the order, calls this, and saves the result.
 *
 * - "applied":   the order changed (or the event was recorded as history).
 * - "duplicate": this event id was already applied; at-least-once delivery
 *                means repeats are normal and must change nothing.
 * - "flagged":   the event was genuine but doesn't match the order (the
 *                wrong amount, say), so the order goes to needs_review
 *                instead of being fulfilled.
 * - "retry":     the event arrived before the one it depends on (an
 *                instalment before its plan). Answer non-2xx so Polaris
 *                redelivers it later; nothing is recorded.
 */
export type ApplyOutcome = "applied" | "duplicate" | "flagged" | "retry";

export type ApplyResult = { outcome: ApplyOutcome; order: Order; reason?: string };

const MODE_LABEL = { now: "Pay now", later: "Pay in 4", subscribe: "Subscription", direct: "Direct wallet payment" } as const;

export function applyEvent(order: Order, event: PolarisEvent, now: Date = new Date()): ApplyResult {
  if (order.events.some((e) => e.id === event.id)) return { outcome: "duplicate", order };

  const next: Order = structuredClone(order);
  const at = now.toISOString();
  const record = (summary: string, outcome: ReceivedEvent["outcome"] = "applied"): ApplyResult => {
    next.events.push({ id: event.id, type: event.type, created: event.created, receivedAt: at, summary, outcome });
    next.updatedAt = at;
    return { outcome, order: next };
  };
  const flag = (reason: string): ApplyResult => {
    if (next.status !== "paid") {
      next.status = "needs_review";
      next.statusReason = reason;
    }
    const result = record(reason, "flagged");
    return { ...result, reason };
  };

  switch (event.type) {
    case "payment.succeeded": {
      const data = event.data;
      const amount = decimalToCents(data.amount);
      if (data.currency !== "USD") return flag(`Payment arrived in ${String(data.currency)}, not USD.`);
      if (amount !== order.total) {
        return flag(`Payment of ${amount === null ? data.amount : formatUsd(amount)} doesn't match the order total of ${formatUsd(order.total)}.`);
      }
      markPaid(next, at, data.mode, { payer: data.payer, txHash: data.txHash, paymentId: data.paymentId });
      return record(`${formatUsd(amount)} paid${data.mode in MODE_LABEL ? ` · ${MODE_LABEL[data.mode]}` : ""}`);
    }

    case "plan.opened": {
      const data = event.data;
      const installments = data.installments.map((inst) => ({
        index: inst.index,
        amount: decimalToCents(inst.amount) ?? 0,
        dueAt: inst.dueAt,
        status: inst.status,
        paidAt: inst.paidAt ?? null,
      }));
      const planTotal = decimalToCents(data.amount);
      if (planTotal !== order.total) {
        return flag(`A plan for ${data.amount} doesn't match the order total of ${formatUsd(order.total)}.`);
      }
      next.plan = { planId: data.planId, intervalSeconds: data.intervalSeconds, status: "active", installments };
      return record(`Pay in 4 plan opened · ${installments.length} payments of ${formatUsd(installments[0]?.amount ?? 0)}`);
    }

    case "installment.collected":
    case "installment.failed": {
      const plan = next.plan;
      if (!plan || plan.planId !== event.data.planId) return { outcome: "retry", order, reason: "The plan for this instalment hasn't arrived yet." };
      const inst = plan.installments.find((i) => i.index === event.data.index);
      if (!inst) return { outcome: "retry", order, reason: `Instalment ${event.data.index} isn't on the plan.` };
      if (event.type === "installment.collected") {
        inst.status = "paid";
        inst.paidAt = new Date(event.created * 1000).toISOString();
        plan.status = plan.installments.every((i) => i.status === "paid") ? "completed" : "active";
        return record(`Instalment ${inst.index} of ${plan.installments.length} collected · ${formatUsd(inst.amount)}`);
      }
      inst.status = "failed";
      plan.status = "past_due";
      return record(`Instalment ${inst.index} of ${plan.installments.length} missed${event.data.reason ? ` · ${event.data.reason}` : ""}`);
    }

    case "plan.completed": {
      if (!next.plan || next.plan.planId !== event.data.planId) return { outcome: "retry", order, reason: "The plan hasn't arrived yet." };
      closePlan(next.plan, "completed", event.created);
      return record("Pay in 4 plan completed");
    }

    case "plan.liquidated": {
      if (!next.plan || next.plan.planId !== event.data.planId) return { outcome: "retry", order, reason: "The plan hasn't arrived yet." };
      // The store was paid in full at checkout; a defaulted plan is Polaris's loss, not ours.
      next.plan.status = "liquidated";
      return record("Pay in 4 plan closed by Polaris after missed payments. The order stays paid.");
    }

    case "subscription.charged": {
      const data = event.data;
      const amount = decimalToCents(data.amount);
      if (amount !== order.total) {
        return flag(`A subscription charge of ${data.amount} doesn't match ${formatUsd(order.total)} a period.`);
      }
      const periodsCharged = Math.max(next.subscription?.periodsCharged ?? 0, data.period);
      next.subscription = {
        subscriptionId: data.subscriptionId,
        interval: data.interval,
        intervalCount: data.intervalCount,
        nextChargeAt: data.nextChargeAt,
        periodsCharged,
        status: next.subscription?.status === "canceled" ? "canceled" : "active",
        canceledAt: next.subscription?.canceledAt,
      };
      if (data.period === 1) markPaid(next, at, "subscribe", { txHash: data.txHash });
      return record(`Subscription charged · period ${data.period} · ${formatUsd(amount)}`);
    }

    case "subscription.canceled": {
      if (!next.subscription || next.subscription.subscriptionId !== event.data.subscriptionId) {
        return { outcome: "retry", order, reason: "The subscription hasn't arrived yet." };
      }
      next.subscription.status = "canceled";
      next.subscription.canceledAt = event.data.canceledAt;
      return record("Subscription canceled");
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

function closePlan(plan: OrderPlan, status: OrderPlan["status"], created: number) {
  plan.status = status;
  for (const inst of plan.installments) {
    if (inst.status !== "paid") {
      inst.status = "paid";
      inst.paidAt = new Date(created * 1000).toISOString();
    }
  }
}

/** The order an event is about: metadata.orderId from a session, else the on-chain order id. */
export function orderIdForEvent(event: PolarisEvent): string | null {
  const data = event.data as { orderId?: unknown; metadata?: Record<string, unknown> };
  const fromMetadata = data.metadata?.orderId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  return typeof data.orderId === "string" && data.orderId ? data.orderId : null;
}
