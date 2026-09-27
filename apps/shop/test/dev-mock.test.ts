import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { MONAD_TESTNET, validateWebhookEvent, type PlanOpenedData } from "polarispay-sdk";
import { encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";
import { devMockEnabled, devMockSecrets } from "@/lib/dev-polaris/guard";
import { MOCK_DOMAIN, MOCK_PAYMENTS, advanceSession, completeSession, createSession, mockKeys, relayPayment, resetMockState, type RelayRequest } from "@/lib/dev-polaris/mock";
import { browserConfig, resolvePolarisConfig } from "@/lib/polaris";

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const merchant = "0x4a1c000000000000000000000000000000000000" as const;

beforeEach(() => resetMockState());
afterEach(() => vi.unstubAllEnvs());

describe("the dev mock can't exist in production", () => {
  it("is compiled only for `next dev`", () => {
    const dev = nextConfig(PHASE_DEVELOPMENT_SERVER);
    expect(dev.pageExtensions).toContain("dev.ts");
    expect(dev.pageExtensions).toContain("dev.tsx");
    expect(dev.env).toEqual({ HALCYON_DEV_MOCK: "1" });
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      expect(nextConfig(phase).pageExtensions).toEqual(["tsx", "ts"]);
      // Inlined into the bundle: a production build can't switch the mock on at runtime.
      expect(nextConfig(phase).env).toEqual({ HALCYON_DEV_MOCK: "0" });
    }
  });

  it("answers only in a development build under development, and never over a configured backend", () => {
    vi.stubEnv("HALCYON_DEV_MOCK", "1");
    expect(devMockEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devMockEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devMockEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devMockEnabled({ NODE_ENV: "development", POLARIS_API_BASE: "http://localhost:3100" })).toBe(false);
    // A production build started with NODE_ENV=development (the review's forgery) still has no mock.
    vi.stubEnv("HALCYON_DEV_MOCK", "0");
    expect(devMockEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("is never chosen as the Polaris backend outside a development build", () => {
    vi.stubEnv("HALCYON_DEV_MOCK", "1");
    expect(resolvePolarisConfig({ NODE_ENV: "production" }, "https://shop.example")).toMatchObject({ ok: false });
    expect(resolvePolarisConfig({ NODE_ENV: "test" }, "https://shop.example")).toMatchObject({ ok: false });
    expect(resolvePolarisConfig({ NODE_ENV: "development" }, "http://localhost:3600")).toMatchObject({ ok: true, target: "dev-mock" });
    vi.stubEnv("HALCYON_DEV_MOCK", "0");
    expect(resolvePolarisConfig({ NODE_ENV: "development" }, "http://localhost:3600")).toMatchObject({ ok: false });
  });

  it("reaches the mock on a fixed local origin, whatever Host a request names", () => {
    vi.stubEnv("HALCYON_DEV_MOCK", "1");
    for (const origin of ["http://localhost:3600", "http://attacker.example:3634"]) {
      expect(resolvePolarisConfig({ NODE_ENV: "development" }, origin)).toMatchObject({ baseUrl: "http://127.0.0.1:3600/api/dev-polaris" });
    }
    expect(resolvePolarisConfig({ NODE_ENV: "development", PORT: "3611" }, "http://x")).toMatchObject({ baseUrl: "http://127.0.0.1:3611/api/dev-polaris" });
  });

  it("uses random per-process secrets, and never sends the mock a real key", () => {
    vi.stubEnv("HALCYON_DEV_MOCK", "1");
    const env = { NODE_ENV: "development", POLARIS_SECRET_KEY: "sk_test_realkey123", POLARIS_WEBHOOK_SECRET: "whsec_real" };
    const config = resolvePolarisConfig(env, "http://localhost:3600");
    if (!config.ok) throw new Error(config.reason);
    expect(config.secretKey).not.toBe("sk_test_realkey123");
    expect(config.webhookSecret).not.toBe("whsec_real");
    expect(config.secretKey).toBe(devMockSecrets().secretKey);
    expect(config.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(config.secretKey).toMatch(/^sk_test_[0-9a-f]{32}$/);
    expect(mockKeys(env)).toMatchObject({ secretKey: config.secretKey, webhookSecret: config.webhookSecret });
  });

  it("uses a real backend whenever POLARIS_API_BASE is set, and demands every key for it", () => {
    const partial = resolvePolarisConfig({ NODE_ENV: "development", POLARIS_API_BASE: "http://localhost:3100" }, "http://localhost:3600");
    expect(partial).toMatchObject({ ok: false });
    expect(!partial.ok && partial.reason).toMatch(/POLARIS_SECRET_KEY/);
  });

  it("gives the browser no secrets", () => {
    vi.stubEnv("POLARIS_API_BASE", "http://localhost:3100");
    vi.stubEnv("POLARIS_SECRET_KEY", "sk_test_topsecret123");
    vi.stubEnv("POLARIS_WEBHOOK_SECRET", "whsec_topsecret");
    vi.stubEnv("NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY", "pk_test_public12345");
    vi.stubEnv("NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN", "http://localhost:3000");
    vi.stubEnv("POLARIS_MERCHANT_ADDRESS", merchant);
    const config = JSON.stringify(browserConfig());
    expect(config).not.toContain("sk_test");
    expect(config).not.toContain("whsec");
    expect(config).toContain("pk_test_public12345");
  });
});

describe("dev mock sessions speak the real API", () => {
  const body = {
    amount: "349.00",
    currency: "USD",
    description: "Halcyon order",
    lineItems: [{ name: "Halcyon One, Graphite", quantity: 1, unitAmount: "349.00" }],
    modes: ["later", "now"],
    subscription: null,
    successUrl: "http://localhost:3600/orders/hc_1",
    cancelUrl: null,
    orderId: "hc_1",
    metadata: { orderNumber: "HC-10001" },
  };

  it("returns a CheckoutSession, and implements idempotency", () => {
    const a = createSession(body, "key_1", "http://localhost:3600");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ object: "checkout.session", status: "open", paymentStatus: "unpaid", orderId: "hc_1", lineItems: [{ amount: "349.00" }] });
    const b = createSession(body, "key_1", "http://localhost:3600");
    expect((b.body as { id: string }).id).toBe((a.body as { id: string }).id);
    expect(b.replayed).toBe(true);
    const c = createSession({ ...body, amount: "348.00", lineItems: [{ name: "x", quantity: 1, unitAmount: "348.00" }] }, "key_1", "http://localhost:3600");
    expect(c.status).toBe(409);
  });

  it("validates like the real API", () => {
    expect(createSession({ ...body, amount: "-1" }, null, "http://x").status).toBe(400);
    expect(createSession({ ...body, modes: [] }, null, "http://x").status).toBe(400);
    expect(createSession({ ...body, successUrl: "/relative" }, null, "http://x").status).toBe(400);
    expect(createSession({ ...body, lineItems: [{ name: "x", quantity: 1, unitAmount: "1.00" }] }, null, "http://x").status).toBe(400);
    expect(createSession({ ...body, modes: ["subscribe"] }, null, "http://x").status).toBe(400);
  });

  it("completing Pay in 4 sends plan.opened for the order, and answers the store with the protocol's details", () => {
    const created = createSession(body, null, "http://localhost:3600").body as { id: string };
    const done = completeSession(created.id, "later");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.events.map((e) => e.type)).toEqual(["plan.opened"]);
    expect(done.events[0]!.data).toMatchObject({ orderId: "hc_1", principal: "349.00", installments: 4, sessionId: created.id });
    expect(done.result).toMatchObject({ mode: "later", orderId: "hc_1" });
    expect(done.session).toMatchObject({ status: "complete", paymentStatus: "paid" });
    expect(completeSession(created.id, "later")).toMatchObject({ ok: false, status: 409 });
  });

  it("opens Pay in 4 on the loan engine's terms: interest, six decimals, the first payment one week out", () => {
    vi.stubEnv("POLARIS_PAY_IN_4_APR_BPS", "1000");
    const now = new Date("2026-10-01T12:00:00.000Z");
    const created = createSession(body, null, "http://127.0.0.1:3600", now).body as { id: string };
    const done = completeSession(created.id, "later", now);
    if (!done.ok) throw new Error(done.message);
    const data = done.events[0]!.data as PlanOpenedData;
    // $349 at 10% APR for 28 days: 2677260 base units of interest, as PolarisLoanEngine computes it.
    expect(data).toMatchObject({ principal: "349.00", interest: "2.67726", total: "351.67726", installments: 4, intervalSeconds: 604800 });
    expect(data.schedule.map((s) => s.amount)).toEqual(["87.919315", "87.919315", "87.919315", "87.919315"]);
    // installmentDueAt(i) = startedAt + (i + 1) x interval: nothing is due at opening.
    expect(data.schedule.map((s) => s.dueAt)).toEqual([
      "2026-10-08T12:00:00.000Z",
      "2026-10-15T12:00:00.000Z",
      "2026-10-22T12:00:00.000Z",
      "2026-10-29T12:00:00.000Z",
    ]);
    // Every event the mock sends has the SDK's exact shape.
    expect(validateWebhookEvent(done.events[0])).toEqual([]);
    const first = advanceSession(created.id, "next", now);
    if (!first.ok) throw new Error(first.message);
    expect(first.events[0]!.data).toMatchObject({ installment: 1, amount: "87.919315", remaining: "263.757945" });
    expect(validateWebhookEvent(first.events[0])).toEqual([]);
  });
});

describe("dev mock relayer (polarispay-sdk's RelayPayRequest)", () => {
  async function request(orderId: string, signer = buyer, units = 349_000_000n): Promise<RelayRequest> {
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
    const nonce = keccak256(encodePacked(["address", "string"], [merchant, orderId]));
    const signature = await signer.signTypedData({
      domain: { ...MOCK_DOMAIN, chainId: MONAD_TESTNET.chainId, verifyingContract: MONAD_TESTNET.stablecoin },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: { from: buyer.address, to: MOCK_PAYMENTS, value: units, validAfter: 0n, validBefore, nonce },
    });
    return {
      type: "payWithAuthorization",
      chainId: MONAD_TESTNET.chainId,
      contract: MOCK_PAYMENTS,
      payer: buyer.address,
      merchant,
      amount: units.toString(),
      orderId,
      validAfter: "0",
      validBefore: validBefore.toString(),
      nonce,
      signature,
    };
  }

  it("accepts the buyer's ERC-3009 signature and emits payment.succeeded for the order", async () => {
    const result = await relayPayment(await request("hc_direct_1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.type).toBe("payment.succeeded");
    expect(result.event.data).toMatchObject({ orderId: "hc_direct_1", amount: "349.00", mode: "now", sessionId: null, payer: buyer.address });
  });

  it("rejects a signature from someone other than the payer", async () => {
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    expect(await relayPayment(await request("hc_direct_2", stranger))).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  it("rejects an authorization moved to another order", async () => {
    const auth = await request("hc_direct_3");
    expect(await relayPayment({ ...auth, orderId: "hc_direct_other" })).toMatchObject({ ok: false, code: "nonce_mismatch" });
  });

  it("relays only to the store's own payout address", async () => {
    const auth = await request("hc_direct_5");
    expect(await relayPayment({ ...auth, merchant: buyer.address })).toMatchObject({ ok: false, code: "unknown_merchant" });
  });

  it("refuses any contract but PolarisPayments, and a second payment of the same order", async () => {
    const auth = await request("hc_direct_4");
    expect(await relayPayment({ ...auth, contract: merchant })).toMatchObject({ ok: false, code: "wrong_contract" });
    expect((await relayPayment(auth)).ok).toBe(true);
    expect(await relayPayment(auth)).toMatchObject({ ok: false, code: "duplicate_payment" });
  });
});
