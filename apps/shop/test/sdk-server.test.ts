import { describe, expect, it, vi } from "vitest";

import { PolarisError } from "@/lib/polaris-sdk/errors";
import { quotePayIn4 } from "@/lib/polaris-sdk/money";
import { createPolarisServer } from "@/lib/polaris-sdk/server";

const session = { id: "cs_1", object: "checkout.session", url: "https://pay.test/pay/cs_1", status: "open", expiresAt: "2026-10-01T00:00:00.000Z" };

describe("createPolarisServer (the 0.3.0 stand-in)", () => {
  it("refuses a publishable key, or no key, on the server", () => {
    expect(() => createPolarisServer({ secretKey: "pk_test_abcdefgh" })).toThrow(/publishable key/);
    expect(() => createPolarisServer({ secretKey: "" })).toThrow(/secretKey/);
    expect(() => createPolarisServer({ secretKey: "hunter2" })).toThrow(/sk_test_/);
  });

  it("creates a session with the documented request, normalising amounts", async () => {
    const fetch = vi.fn(async () => Response.json(session));
    const polaris = createPolarisServer({ secretKey: "sk_test_abcdefgh", baseUrl: "https://api.test/", fetch });
    const created = await polaris.checkout.sessions.create(
      { amount: "200", currency: "USD", description: "Logo", modes: ["now", "later"], successUrl: "https://studio.test/thanks", lineItems: [{ name: "Logo", quantity: 1, unitAmount: "200" }] },
      { idempotencyKey: "order_1" },
    );
    expect(created.url).toBe(session.url);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk_test_abcdefgh");
    expect(headers["idempotency-key"]).toBe("order_1");
    expect(headers["polaris-client"]).toBe("polarispay-sdk/0.3.0");
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: "200.00", lineItems: [{ unitAmount: "200.00" }] });
  });

  it("retrieves a session by id", async () => {
    const fetch = vi.fn(async () => Response.json(session));
    const polaris = createPolarisServer({ secretKey: "sk_test_abcdefgh", baseUrl: "https://api.test", fetch });
    await polaris.checkout.sessions.retrieve("cs_1");
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://api.test/api/v1/checkout/sessions/cs_1");
  });

  it("does not retry a POST without an idempotency key", async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: "down" } }, { status: 503 }));
    const polaris = createPolarisServer({ secretKey: "sk_test_abcdefgh", baseUrl: "https://api.test", fetch });
    await expect(polaris.checkout.sessions.create({ amount: "1.00", currency: "USD", description: "x", modes: ["now"], successUrl: "https://x.test" })).rejects.toMatchObject({
      type: "api_error",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps API errors to typed PolarisErrors", async () => {
    const cases: [number, string][] = [
      [401, "authentication_error"],
      [403, "permission_error"],
      [409, "idempotency_error"],
      [400, "invalid_request_error"],
    ];
    for (const [status, type] of cases) {
      const fetch = vi.fn(async () => Response.json({ error: { code: "x", message: "no" } }, { status, headers: { "polaris-request-id": "req_1" } }));
      const polaris = createPolarisServer({ secretKey: "sk_test_abcdefgh", baseUrl: "https://api.test", fetch, maxRetries: 0 });
      const error = await polaris.checkout.sessions.retrieve("cs_1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PolarisError);
      expect(error).toMatchObject({ type, status, requestId: "req_1" });
    }
  });

  it("rejects an amount that isn't whole cents before sending anything", async () => {
    const fetch = vi.fn();
    const polaris = createPolarisServer({ secretKey: "sk_test_abcdefgh", baseUrl: "https://api.test", fetch });
    expect(() => polaris.checkout.sessions.create({ amount: "1.005", currency: "USD", description: "x", modes: ["now"], successUrl: "https://x.test" })).toThrow(/amount/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Pay in 4 pricing", () => {
  it("is interest-free at 0 bps: $349 is 4 × $87.25", () => {
    const quote = quotePayIn4("349.00", { aprBps: 0 });
    expect(quote.each).toBe("87.25");
    expect(quote.installments.map((i) => i.amount)).toEqual(["87.25", "87.25", "87.25", "87.25"]);
    expect(quote.interestFree).toBe(true);
  });

  it("matches the loan engine at 10% APR: $200 is 4 × $50.38", () => {
    const quote = quotePayIn4("200.00", { aprBps: 1000 });
    expect(quote.each).toBe("50.38");
    expect(quote.interest).toBe("1.53");
  });

  it("puts the rounding remainder on the last payment", () => {
    const quote = quotePayIn4("159.01", { aprBps: 0 });
    const cents = quote.installments.map((i) => Math.round(Number(i.amount) * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(15901);
  });
});
