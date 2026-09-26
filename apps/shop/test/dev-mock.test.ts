import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";
import { devMockEnabled } from "@/lib/dev-polaris/guard";
import { MOCK_DOMAIN, completeSession, createSession, relayPayment, resetMockState } from "@/lib/dev-polaris/mock";
import { browserConfig, resolvePolarisConfig } from "@/lib/polaris";
import { MONAD_TESTNET, ZERO_ADDRESS, paymentIdFor, receiveAuthorizationTypedData } from "@/lib/polaris-sdk/browser";

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const merchant = "0x4a1c000000000000000000000000000000000000" as const;

beforeEach(() => resetMockState());
afterEach(() => vi.unstubAllEnvs());

describe("the dev mock can't exist in production", () => {
  it("is compiled only for `next dev`", () => {
    const dev = nextConfig(PHASE_DEVELOPMENT_SERVER);
    expect(dev.pageExtensions).toContain("dev.ts");
    expect(dev.pageExtensions).toContain("dev.tsx");
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      const prod = nextConfig(phase);
      expect(prod.pageExtensions).toEqual(["tsx", "ts"]);
    }
  });

  it("answers only in development, and never over a configured backend", () => {
    expect(devMockEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devMockEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devMockEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devMockEnabled({ NODE_ENV: "development", POLARIS_API_BASE: "http://localhost:3100" })).toBe(false);
  });

  it("is never chosen as the Polaris backend outside development", () => {
    expect(resolvePolarisConfig({ NODE_ENV: "production" }, "https://shop.example")).toMatchObject({ ok: false });
    expect(resolvePolarisConfig({ NODE_ENV: "test" }, "https://shop.example")).toMatchObject({ ok: false });
    expect(resolvePolarisConfig({ NODE_ENV: "development" }, "http://localhost:3600")).toMatchObject({
      ok: true,
      target: "dev-mock",
      baseUrl: "http://localhost:3600/api/dev-polaris",
    });
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

describe("dev mock sessions", () => {
  const params = {
    amount: "349.00",
    currency: "USD",
    description: "Halcyon order",
    modes: ["later", "now"],
    successUrl: "http://localhost:3600/orders/hc_1",
    lineItems: [{ name: "Halcyon One", quantity: 1, unitAmount: "349.00" }],
    metadata: { orderId: "hc_1" },
  };

  it("implements idempotency like the real API", () => {
    const a = createSession(params, "key_1", "http://localhost:3600");
    const b = createSession(params, "key_1", "http://localhost:3600");
    expect(a.status).toBe(200);
    expect((b.body as { id: string }).id).toBe((a.body as { id: string }).id);
    expect(b.replayed).toBe(true);
    const c = createSession({ ...params, amount: "348.00", lineItems: [{ name: "x", quantity: 1, unitAmount: "348.00" }] }, "key_1", "http://localhost:3600");
    expect(c.status).toBe(409);
  });

  it("validates like the real API", () => {
    expect(createSession({ ...params, amount: "-1" }, null, "http://x").status).toBe(400);
    expect(createSession({ ...params, modes: [] }, null, "http://x").status).toBe(400);
    expect(createSession({ ...params, successUrl: "/relative" }, null, "http://x").status).toBe(400);
    expect(createSession({ ...params, lineItems: [{ name: "x", quantity: 1, unitAmount: "1.00" }] }, null, "http://x").status).toBe(400);
  });

  it("completing a Pay in 4 session produces plan.opened, payment.succeeded and the first instalment", () => {
    const created = createSession(params, null, "http://localhost:3600").body as { id: string };
    const done = completeSession(created.id, "later");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.events.map((e) => e.type)).toEqual(["plan.opened", "payment.succeeded", "installment.collected"]);
    expect(done.events[1]!.data).toMatchObject({ amount: "349.00", metadata: { orderId: "hc_1" } });
    expect(completeSession(created.id, "later")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("dev mock relayer", () => {
  async function authorization(orderId: string, signer = buyer, amountUnits = 349_000_000n) {
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const typed = receiveAuthorizationTypedData({
      domain: { ...MOCK_DOMAIN, chainId: MONAD_TESTNET.chainId, verifyingContract: MONAD_TESTNET.stablecoin },
      from: buyer.address,
      to: ZERO_ADDRESS,
      value: amountUnits,
      validAfter: 0n,
      validBefore,
      nonce: paymentIdFor(merchant, orderId),
    });
    const { EIP712Domain: _domain, ...types } = typed.types;
    void _domain;
    const signature = await signer.signTypedData({ domain: typed.domain, types, primaryType: "ReceiveWithAuthorization", message: typed.message });
    return {
      payer: buyer.address,
      merchant,
      amount: "349.00",
      value: amountUnits.toString(),
      orderId,
      validAfter: "0",
      validBefore: validBefore.toString(),
      signature,
      chainId: MONAD_TESTNET.chainId,
    };
  }

  it("accepts the buyer's ERC-3009 signature and emits payment.succeeded for the order", async () => {
    const result = await relayPayment(await authorization("hc_direct_1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paymentId).toBe(paymentIdFor(merchant, "hc_direct_1"));
    expect(result.event.data).toMatchObject({ orderId: "hc_direct_1", amount: "349.00", mode: "direct", payer: buyer.address });
  });

  it("rejects a signature from someone other than the payer", async () => {
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const result = await relayPayment(await authorization("hc_direct_2", stranger));
    expect(result).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  it("rejects an authorization moved to another order", async () => {
    const auth = await authorization("hc_direct_3");
    expect(await relayPayment({ ...auth, orderId: "hc_direct_other" })).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  it("refuses to pay the same order twice", async () => {
    const auth = await authorization("hc_direct_4");
    expect((await relayPayment(auth)).ok).toBe(true);
    expect(await relayPayment(auth)).toMatchObject({ ok: false, code: "duplicate_payment" });
  });
});
