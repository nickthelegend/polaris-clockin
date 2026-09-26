import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/checkout/route";
import { createMemoryStore, orderStore, setOrderStore } from "@/lib/orders/store";

import { SECRET, checkoutBody } from "./helpers";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

let calls: Call[] = [];
let sessionCounter = 0;

function polarisFetch(respond?: (call: Call) => Response | undefined) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const custom = respond?.(call);
    if (custom) return custom;
    sessionCounter += 1;
    return Response.json({
      id: `cs_test_${sessionCounter}`,
      object: "checkout.session",
      url: `https://pay.polaris.test/pay/cs_test_${sessionCounter}`,
      status: "open",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  });
}

function post(body: unknown, key?: string) {
  return POST(
    new Request("http://shop.test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  calls = [];
  setOrderStore(createMemoryStore());
  vi.stubEnv("POLARIS_API_BASE", "https://api.polaris.test");
  vi.stubEnv("POLARIS_SECRET_KEY", "sk_test_shopsecret123");
  vi.stubEnv("POLARIS_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY", "pk_test_shoppublic123");
  vi.stubEnv("NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN", "https://pay.polaris.test");
  vi.stubEnv("POLARIS_MERCHANT_ADDRESS", "0x1111111111111111111111111111111111111111");
  vi.stubGlobal("fetch", polarisFetch());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/checkout (Polaris)", () => {
  it("creates the order, then a checkout session through the SDK, and returns its URL", async () => {
    const res = await post(checkoutBody({ method: "polaris", mode: "later" }), "hc_attempt_1_abc");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { order: { id: string; status: string; total: number }; checkout: { sessionId: string; url: string } };
    expect(json.order.status).toBe("awaiting_payment");
    expect(json.order.total).toBe(34900);
    expect(json.checkout.url).toMatch(/^https:\/\/pay\.polaris\.test\/pay\//);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://api.polaris.test/api/v1/checkout/sessions");
    expect(call!.method).toBe("POST");
    expect(call!.headers.authorization).toBe("Bearer sk_test_shopsecret123");
    expect(call!.headers["idempotency-key"]).toBe(`${json.order.id}:session:0`);
    expect(call!.body).toMatchObject({
      amount: "349.00",
      currency: "USD",
      modes: ["later", "now"],
      successUrl: `http://shop.test/orders/${json.order.id}?via=polaris`,
      cancelUrl: `http://shop.test/checkout?order=${json.order.id}&canceled=1`,
      metadata: { orderId: json.order.id },
    });
    const lineItems = call!.body!.lineItems as { unitAmount: string; quantity: number }[];
    const sum = lineItems.reduce((n, i) => n + Number(i.unitAmount) * 100 * i.quantity, 0);
    expect(sum).toBe(34900);

    const stored = (await orderStore().read()).orders[json.order.id]!;
    expect(stored.payment.sessionId).toBe(json.checkout.sessionId);
    expect(stored.sdkLog[0]?.call).toBe("polaris.checkout.sessions.create");
    // The drawer's log never carries a key.
    expect(JSON.stringify(stored.sdkLog)).not.toContain("sk_test");
  });

  it("prices from the catalogue, not the browser", async () => {
    const body = checkoutBody({ method: "polaris", mode: "now" }, [{ productId: "arc-lamp", optionId: "chalk-brass", quantity: 1, price: 1 }]);
    const res = await post(body, "hc_attempt_price_1");
    const json = (await res.json()) as { order: { total: number } };
    expect(json.order.total).toBe(15900);
    expect(calls[0]!.body!.amount).toBe("159.00");
  });

  it("is idempotent: the same key and body return the same order and session, with no second session", async () => {
    const first = (await (await post(checkoutBody(), "hc_attempt_same_1")).json()) as { order: { id: string }; checkout: { url: string } };
    const second = (await (await post(checkoutBody(), "hc_attempt_same_1")).json()) as { order: { id: string }; checkout: { url: string }; reused: boolean };
    expect(second.order.id).toBe(first.order.id);
    expect(second.checkout.url).toBe(first.checkout.url);
    expect(second.reused).toBe(true);
    expect(calls).toHaveLength(1);
    expect(Object.keys((await orderStore().read()).orders)).toHaveLength(1);
  });

  it("refuses the same key with a different body", async () => {
    await post(checkoutBody({ method: "polaris", mode: "later" }), "hc_attempt_conflict");
    const res = await post(checkoutBody({ method: "polaris", mode: "now" }), "hc_attempt_conflict");
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("opens a new session, under a new idempotency key, once the old one has expired", async () => {
    vi.stubGlobal(
      "fetch",
      polarisFetch(() =>
        Response.json({ id: "cs_old", object: "checkout.session", url: "https://pay.polaris.test/pay/cs_old", status: "open", expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    );
    const first = (await (await post(checkoutBody(), "hc_attempt_expired")).json()) as { order: { id: string } };
    vi.stubGlobal("fetch", polarisFetch());
    await post(checkoutBody(), "hc_attempt_expired");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers["idempotency-key"]).toBe(`${first.order.id}:session:1`);
  });

  it("retries a 5xx from Polaris with the same idempotency key", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      polarisFetch(() => (++n === 1 ? Response.json({ error: { message: "busy" } }, { status: 503 }) : undefined)),
    );
    const res = await post(checkoutBody(), "hc_attempt_retry_1");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers["idempotency-key"]).toBe(calls[1]!.headers["idempotency-key"]);
  });

  it("answers 502 with a buyer-safe message when Polaris is down, and logs the failed call", async () => {
    vi.stubGlobal("fetch", polarisFetch(() => Response.json({ error: { type: "invalid_request_error", message: "nope" } }, { status: 400 })));
    const res = await post(checkoutBody(), "hc_attempt_down_1");
    expect(res.status).toBe(502);
    const order = Object.values((await orderStore().read()).orders)[0]!;
    expect(order.status).toBe("awaiting_payment");
    expect(order.sdkLog[0]?.error).toBe("nope");
  });

  it("validates the request", async () => {
    const res = await post({ ...checkoutBody(), contact: { email: "not-an-email" } }, "hc_attempt_invalid");
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { fields: Record<string, string> } };
    expect(json.error.fields["contact.email"]).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("only lets the Coffee Club check out as a subscription, alone", async () => {
    const club = [{ productId: "coffee-club", optionId: "filter", quantity: 1 }];
    expect((await post(checkoutBody({ method: "polaris", mode: "now" }, club), "hc_attempt_sub_1")).status).toBe(422);
    expect((await post(checkoutBody({ method: "wallet" }, club), "hc_attempt_sub_2")).status).toBe(422);
    const mixed = [...club, { productId: "keys-75", optionId: "linear", quantity: 1 }];
    expect((await post(checkoutBody({ method: "polaris", mode: "subscribe" }, mixed), "hc_attempt_sub_3")).status).toBe(422);
    const ok = await post(checkoutBody({ method: "polaris", mode: "subscribe" }, club), "hc_attempt_sub_4");
    expect(ok.status).toBe(200);
    expect(calls[0]!.body).toMatchObject({ amount: "18.00", modes: ["subscribe"], subscription: { interval: "month", intervalCount: 1 } });
  });
});

describe("POST /api/checkout (wallet)", () => {
  it("returns what pay() needs, and calls nothing at Polaris", async () => {
    const res = await post(checkoutBody({ method: "wallet" }), "hc_attempt_wallet_1");
    const json = (await res.json()) as { order: { id: string }; wallet: { merchant: string; amount: string; orderId: string } };
    expect(json.wallet).toEqual({ merchant: "0x1111111111111111111111111111111111111111", amount: "349.00", orderId: json.order.id });
    expect(json.order.id).toMatch(/^hc_[a-z2-7]{20}$/);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/checkout (not configured)", () => {
  it("never falls back to the dev mock outside development", async () => {
    vi.stubEnv("POLARIS_API_BASE", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await post(checkoutBody(), "hc_attempt_prod_1");
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
