import { describe, expect, it } from "vitest";

import { applyEvent, orderIdForEvent } from "@/lib/orders/transitions";

import { baseOrder, event } from "./helpers";

const ref = { orderId: "hc_testorder000000000001", sessionId: "cs_test_1", metadata: { orderId: "hc_testorder000000000001" } };

function plan(amount = "349.00") {
  return event("plan.opened", {
    ...ref,
    planId: "plan_1",
    amount,
    currency: "USD",
    intervalSeconds: 604800,
    installments: [1, 2, 3, 4].map((index) => ({
      index,
      amount: "87.25",
      dueAt: new Date(Date.now() + (index - 1) * 604800_000).toISOString(),
      status: index === 1 ? ("due" as const) : ("upcoming" as const),
    })),
  });
}

describe("order status transitions", () => {
  it("awaiting_payment → paid on a payment.succeeded that matches the order", () => {
    const r = applyEvent(baseOrder(), event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "USD", mode: "later", txHash: "0xabc" }));
    expect(r.outcome).toBe("applied");
    expect(r.order.status).toBe("paid");
    expect(r.order.payment.mode).toBe("later");
    expect(r.order.payment.paidAt).toBeTruthy();
    expect(r.order.events).toHaveLength(1);
  });

  it("→ needs_review, never paid, when the amount doesn't match", () => {
    const r = applyEvent(baseOrder(), event("payment.succeeded", { ...ref, paymentId: "p1", amount: "0.01", currency: "USD", mode: "now" }));
    expect(r.outcome).toBe("flagged");
    expect(r.order.status).toBe("needs_review");
    expect(r.order.statusReason).toMatch(/doesn't match/);
  });

  it("→ needs_review when the currency isn't USD", () => {
    const e = event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "EUR" as "USD", mode: "now" });
    expect(applyEvent(baseOrder(), e).order.status).toBe("needs_review");
  });

  it("a redelivered event changes nothing", () => {
    const e = event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "USD", mode: "now" });
    const once = applyEvent(baseOrder(), e).order;
    const twice = applyEvent(once, e);
    expect(twice.outcome).toBe("duplicate");
    expect(twice.order).toBe(once);
    expect(twice.order.events).toHaveLength(1);
  });

  it("a paid order never goes back, even if a mismatched event follows", () => {
    const paid = applyEvent(baseOrder(), event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "USD", mode: "now" })).order;
    const r = applyEvent(paid, event("payment.succeeded", { ...ref, paymentId: "p2", amount: "5.00", currency: "USD", mode: "now" }));
    expect(r.outcome).toBe("flagged");
    expect(r.order.status).toBe("paid");
  });

  it("does not mark paid from plan.opened alone, but records the four-payment schedule", () => {
    const r = applyEvent(baseOrder(), plan());
    expect(r.order.status).toBe("awaiting_payment");
    expect(r.order.plan?.installments.map((i) => i.amount)).toEqual([8725, 8725, 8725, 8725]);
    expect(r.order.plan?.status).toBe("active");
  });

  it("walks a Pay in 4 plan to completion", () => {
    let order = applyEvent(baseOrder(), plan()).order;
    order = applyEvent(order, event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "USD", mode: "later" })).order;
    for (const index of [1, 2, 3]) {
      order = applyEvent(order, event("installment.collected", { ...ref, planId: "plan_1", index, amount: "87.25" })).order;
    }
    expect(order.plan?.installments.filter((i) => i.status === "paid")).toHaveLength(3);
    expect(order.plan?.status).toBe("active");
    order = applyEvent(order, event("installment.collected", { ...ref, planId: "plan_1", index: 4, amount: "87.25" })).order;
    expect(order.plan?.status).toBe("completed");
    order = applyEvent(order, event("plan.completed", { ...ref, planId: "plan_1" })).order;
    expect(order.plan?.status).toBe("completed");
    expect(order.status).toBe("paid");
  });

  it("marks a missed instalment, and keeps the order paid if Polaris later liquidates the plan", () => {
    let order = applyEvent(baseOrder(), plan()).order;
    order = applyEvent(order, event("payment.succeeded", { ...ref, paymentId: "p1", amount: "349.00", currency: "USD", mode: "later" })).order;
    order = applyEvent(order, event("installment.failed", { ...ref, planId: "plan_1", index: 2, amount: "87.25", reason: "Balance too low" })).order;
    expect(order.plan?.status).toBe("past_due");
    expect(order.plan?.installments[1]?.status).toBe("failed");
    order = applyEvent(order, event("plan.liquidated", { ...ref, planId: "plan_1" })).order;
    expect(order.plan?.status).toBe("liquidated");
    expect(order.status).toBe("paid");
  });

  it("asks for a retry when an instalment arrives before its plan, recording nothing", () => {
    const order = baseOrder();
    const r = applyEvent(order, event("installment.collected", { ...ref, planId: "plan_1", index: 1, amount: "87.25" }));
    expect(r.outcome).toBe("retry");
    expect(r.order).toBe(order);
    expect(order.events).toHaveLength(0);
  });

  it("flags a plan whose principal doesn't match the order", () => {
    expect(applyEvent(baseOrder(), plan("300.00")).outcome).toBe("flagged");
  });

  it("starts a subscription on its first charge, and moves the next charge date on renewals", () => {
    const sub = baseOrder({ kind: "subscription", total: 1800, subtotal: 1800, payment: { method: "polaris", requestedMode: "subscribe", sessionAttempt: 0 } });
    const next = new Date(Date.now() + 30 * 86400_000).toISOString();
    let order = applyEvent(
      sub,
      event("subscription.charged", { ...ref, subscriptionId: "sub_1", amount: "18.00", currency: "USD", period: 1, interval: "month", intervalCount: 1, nextChargeAt: next }),
    ).order;
    expect(order.status).toBe("paid");
    expect(order.subscription).toMatchObject({ status: "active", periodsCharged: 1, nextChargeAt: next });
    const later = new Date(Date.now() + 60 * 86400_000).toISOString();
    order = applyEvent(
      order,
      event("subscription.charged", { ...ref, subscriptionId: "sub_1", amount: "18.00", currency: "USD", period: 2, interval: "month", intervalCount: 1, nextChargeAt: later }),
    ).order;
    expect(order.subscription).toMatchObject({ periodsCharged: 2, nextChargeAt: later });
    order = applyEvent(order, event("subscription.canceled", { ...ref, subscriptionId: "sub_1", canceledAt: new Date().toISOString() })).order;
    expect(order.subscription?.status).toBe("canceled");
    expect(order.status).toBe("paid");
  });

  it("finds the order from metadata.orderId first, then the on-chain order id", () => {
    expect(orderIdForEvent(event("payment.succeeded", { orderId: "chain_id", metadata: { orderId: "hc_meta" }, paymentId: "p", amount: "1.00", currency: "USD", mode: "now" }))).toBe("hc_meta");
    expect(orderIdForEvent(event("payment.succeeded", { orderId: "hc_direct", paymentId: "p", amount: "1.00", currency: "USD", mode: "direct" }))).toBe("hc_direct");
  });
});
