import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/polaris/route";
import { createMemoryStore, orderStore, setOrderStore } from "@/lib/orders/store";
import { createOrder } from "@/lib/orders/service";
import type { PolarisEvent } from "@/lib/polaris-sdk/types";

import { SECRET, event, priced, signed } from "./helpers";

function deliver(e: PolarisEvent | string, header?: string | null) {
  const body = typeof e === "string" ? e : JSON.stringify(e);
  return POST(
    new Request("http://shop.test/api/webhooks/polaris", {
      method: "POST",
      headers: { "content-type": "application/json", ...(header === null ? {} : { "polaris-signature": header ?? signed(body) }) },
      body,
    }),
  );
}

let orderId = "";

beforeEach(async () => {
  setOrderStore(createMemoryStore());
  vi.stubEnv("POLARIS_API_BASE", "https://api.polaris.test");
  vi.stubEnv("POLARIS_SECRET_KEY", "sk_test_shopsecret123");
  vi.stubEnv("POLARIS_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY", "pk_test_shoppublic123");
  vi.stubEnv("NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN", "https://pay.polaris.test");
  vi.stubEnv("POLARIS_MERCHANT_ADDRESS", "0x1111111111111111111111111111111111111111");
  const created = await createOrder(priced(), "hc_webhook_test");
  if (!created.ok) throw new Error("no order");
  orderId = created.order.id;
});

afterEach(() => vi.unstubAllEnvs());

const paid = () =>
  event("payment.succeeded", { orderId, metadata: { orderId }, sessionId: "cs_test_1", paymentId: "pay_1", amount: "349.00", currency: "USD", mode: "later" });

async function status() {
  return (await orderStore().read()).orders[orderId]!.status;
}

describe("POST /api/webhooks/polaris", () => {
  it("a valid, signed payment.succeeded marks the order paid", async () => {
    const res = await deliver(paid());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, outcome: "applied" });
    expect(await status()).toBe("paid");
  });

  it("a tampered body is rejected and changes nothing", async () => {
    const e = paid();
    const body = JSON.stringify(e);
    const header = signed(body);
    // Someone replays a real delivery for another order id, keeping the signature.
    const res = await deliver(body.replaceAll(orderId, "hc_someone_elses_order"), header);
    expect(res.status).toBe(400);
    expect(await status()).toBe("awaiting_payment");
  });

  it("an unsigned delivery is rejected", async () => {
    expect((await deliver(paid(), null)).status).toBe(400);
    expect(await status()).toBe("awaiting_payment");
  });

  it("a stale delivery (a captured request replayed later) is rejected", async () => {
    const body = JSON.stringify(paid());
    const res = await deliver(body, signed(body, SECRET, Math.floor(Date.now() / 1000) - 600));
    expect(res.status).toBe(400);
    expect(await status()).toBe("awaiting_payment");
  });

  it("a redelivered event, freshly signed, is acknowledged once and applied once", async () => {
    const e = paid();
    expect(await (await deliver(e)).json()).toMatchObject({ outcome: "applied" });
    const again = await deliver(e);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ outcome: "duplicate" });
    const order = (await orderStore().read()).orders[orderId]!;
    expect(order.events).toHaveLength(1);
  });

  it("answers 409 to an instalment that beats its plan, so Polaris redelivers it", async () => {
    const res = await deliver(event("installment.collected", { orderId, metadata: { orderId }, planId: "plan_1", index: 1, amount: "87.25" }));
    expect(res.status).toBe(409);
    const data = await orderStore().read();
    expect(Object.keys(data.events)).toHaveLength(0);
  });

  it("finds the order by session id when metadata is missing", async () => {
    await orderStore().update((d) => {
      d.orders[orderId]!.payment.sessionId = "cs_by_session";
    });
    const e = event("payment.succeeded", { sessionId: "cs_by_session", paymentId: "pay_2", amount: "349.00", currency: "USD", mode: "now" });
    expect((await deliver(e)).status).toBe(200);
    expect(await status()).toBe("paid");
  });

  it("acknowledges events about other orders, and payouts, without touching this one", async () => {
    const other = event("payment.succeeded", { orderId: "hc_unknown", paymentId: "p", amount: "1.00", currency: "USD", mode: "now" });
    expect(await (await deliver(other)).json()).toMatchObject({ outcome: "ignored" });
    const payout = event("payout.paid", { payoutId: "po_1", amount: "100.00", currency: "USD", destination: "0x1111111111111111111111111111111111111111" });
    expect(await (await deliver(payout)).json()).toMatchObject({ outcome: "ignored" });
    expect(await status()).toBe("awaiting_payment");
  });

  it("a client can't mark an order paid: the order API has no write path", async () => {
    const route = await import("@/app/api/orders/[id]/route");
    expect(Object.keys(route).filter((k) => ["POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
    const log = await import("@/app/api/orders/[id]/log/route");
    const res = await log.POST(
      new Request(`http://shop.test/api/orders/${orderId}/log`, { method: "POST", body: JSON.stringify([{ call: "polaris.pay", result: { status: "paid" } }, { call: "markPaid" }]) }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(await res.json()).toMatchObject({ recorded: 1 });
    expect(await status()).toBe("awaiting_payment");
  });
});
