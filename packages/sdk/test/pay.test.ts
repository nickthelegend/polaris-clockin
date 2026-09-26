import { Interface, Signature, TypedDataEncoder, Wallet, getAddress, keccak256, solidityPacked, verifyTypedData } from "ethers";
import { describe, expect, it, vi } from "vitest";

import { AUSD, MONAD_TESTNET, type PolarisChain } from "../src/chains.js";
import { createPolaris } from "../src/client.js";
import { PolarisError } from "../src/errors.js";
import {
  PAYMENTS_ABI,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  domainFromErc5267,
  paymentId,
  receiveWithAuthorizationTypedData,
} from "../src/pay/eip3009.js";
import { createFakeWallet } from "./helpers/fake-wallet.js";

const PAYMENTS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
/** A deployment of the testnet preset, as it will look once deployments.ts has addresses. */
const CHAIN: PolarisChain = { ...MONAD_TESTNET, payments: PAYMENTS };
const iface = new Interface(PAYMENTS_ABI);

function client(provider: unknown, extra: Record<string, unknown> = {}) {
  return createPolaris({ publishableKey: "pk_test_51Hx8yQfT3sLk2Pz", chain: CHAIN, provider, ...extra });
}

describe("the ERC-3009 authorization", () => {
  it("derives the nonce exactly as PolarisPayments does: keccak256(abi.encodePacked(merchant, orderId))", () => {
    expect(paymentId(MERCHANT, "INV-2041")).toBe(keccak256(solidityPacked(["address", "string"], [MERCHANT, "INV-2041"])));
    // Checksum-insensitive, order-sensitive.
    expect(paymentId(MERCHANT.toLowerCase(), "INV-2041")).toBe(paymentId(MERCHANT, "INV-2041"));
    expect(paymentId(MERCHANT, "INV-2042")).not.toBe(paymentId(MERCHANT, "INV-2041"));
  });

  it("reproduces AUSD's live domain separator on Monad testnet (docs/research/ausd.md)", () => {
    // fields 0x0f: name, version, chainId, verifyingContract. The salt AUSD reports is excluded.
    const domain = domainFromErc5267(
      { name: "Agora Dollar", version: "1", chainId: 10143n, verifyingContract: AUSD.monadTestnet, salt: `0x${"00".repeat(32)}` },
      "0x0f",
    );
    expect(domain).not.toHaveProperty("salt");
    expect(TypedDataEncoder.hashDomain(domain)).toBe("0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1");
  });

  it("builds eth_signTypedData_v4 JSON with only the domain fields present", () => {
    const typed = receiveWithAuthorizationTypedData(
      { name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD.monadTestnet },
      { from: MERCHANT, to: PAYMENTS, value: 25_000_000n, validAfter: 0n, validBefore: 1_790_430_000n, nonce: paymentId(MERCHANT, "x") },
    );
    expect(typed.types.EIP712Domain.map((f) => f.name)).toEqual(["name", "version", "chainId", "verifyingContract"]);
    expect(typed.primaryType).toBe("ReceiveWithAuthorization");
    expect(typed.message.value).toBe("25000000");
    expect(JSON.parse(JSON.stringify(typed))).toEqual(typed);
  });
});

describe("pay(): the wallet sends payWithAuthorization", () => {
  it("signs a ReceiveWithAuthorization to PolarisPayments and sends it with a 15% gas margin", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    const stages: string[] = [];
    const before = Math.floor(Date.now() / 1000);
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "25.00", orderId: "INV-2041", onStage: (s) => stages.push(s) });

    expect(result).toMatchObject({ ok: true, amount: "25.00", relayed: false, payer: fake.wallet.address, paymentId: paymentId(MERCHANT, "INV-2041") });
    expect(result.explorerUrl).toBe(`https://testnet.monadvision.com/tx/${result.transactionHash}`);
    expect(stages).toEqual(["connecting", "signing", "submitting", "confirming"]);

    // What the wallet was asked to sign.
    const [typed] = fake.signed;
    expect(typed!.domain).toEqual({ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD.monadTestnet });
    expect(typed!.primaryType).toBe("ReceiveWithAuthorization");
    expect(typed!.message).toMatchObject({
      from: fake.wallet.address,
      to: PAYMENTS,
      value: "25000000",
      validAfter: "0",
      nonce: paymentId(MERCHANT, "INV-2041"),
    });
    const validBefore = Number(typed!.message.validBefore);
    expect(validBefore).toBeGreaterThanOrEqual(before + 900);
    expect(validBefore).toBeLessThanOrEqual(before + 902);

    // What went on chain.
    const [tx] = fake.sent;
    expect(getAddress(tx!.to)).toBe(PAYMENTS);
    expect(tx!.value).toBe("0x0");
    expect(BigInt(tx!.gas)).toBe(115_000n);
    const decoded = iface.decodeFunctionData("payWithAuthorization", tx!.data);
    expect(decoded[0]).toBe(fake.wallet.address);
    expect(decoded[1]).toBe(MERCHANT);
    expect(decoded[2]).toBe(25_000_000n);
    expect(decoded[3]).toBe("INV-2041");
    expect(decoded[4]).toBe(0n);
    expect(decoded[5]).toBe(BigInt(validBefore));
    const sig = Signature.from({ v: Number(decoded[6]), r: decoded[7], s: decoded[8] });
    const signer = verifyTypedData(typed!.domain, RECEIVE_WITH_AUTHORIZATION_TYPES as never, typed!.message, sig);
    expect(signer).toBe(fake.wallet.address);
  });

  it("reads decimals from the token rather than assuming 6", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { decimals: 18, balance: 10n ** 21n });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "1.50", orderId: "o-1" });
    expect(result.ok).toBe(true);
    expect(fake.signed[0]!.message.value).toBe("1500000000000000000");
  });

  it("switches the wallet to Monad, adding the chain when the wallet has never seen it", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { chainId: 1, knownChains: [1] });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-2" });
    expect(result.ok).toBe(true);
    const add = fake.calls.find((c) => c.method === "wallet_addEthereumChain");
    expect(add?.params).toEqual([
      {
        chainId: "0x279f",
        chainName: "Monad Testnet",
        rpcUrls: ["https://testnet-rpc.monad.xyz"],
        blockExplorerUrls: ["https://testnet.monadvision.com"],
        nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
      },
    ]);
  });

  it("stops before any signature when the order is already paid", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, {
      paid: { payer: MERCHANT, merchant: MERCHANT, amount: 1n, paidAt: 1_790_000_000n },
    });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-3" });
    expect(result).toMatchObject({ ok: false, error: "This order has already been paid." });
    expect(fake.methods()).not.toContain("eth_signTypedData_v4");
  });

  it("stops when the buyer is short, naming both amounts", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { balance: 1_000_000n });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-4" });
    expect(result).toMatchObject({ ok: false, error: "Not enough AUSD: this costs 2.00 and you have 1.00." });
    expect(fake.methods()).not.toContain("eth_signTypedData_v4");
  });

  it("stops when the order is quoted at another price", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { quoted: 3_000_000n });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-5" });
    expect(result).toMatchObject({ ok: false, error: "This order is priced at 3.00, not 2.00." });
  });

  it("turns a rejected signature into a sentence", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { rejectSignature: true });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-6" });
    expect(result).toMatchObject({ ok: false, error: "You cancelled the request." });
    expect(fake.sent).toHaveLength(0);
  });

  it("refuses a signature that doesn't recover to the paying account", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { signWith: Wallet.createRandom() });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-7" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/different account/);
    expect(fake.sent).toHaveLength(0);
  });

  it("reports a reverted transaction", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { receiptStatus: "0x0" });
    const result = await client(fake.provider).pay({ merchant: MERCHANT, amount: "2.00", orderId: "o-8" });
    expect(result).toMatchObject({ ok: false, error: "The payment didn't go through. Nothing was charged." });
    expect(result.transactionHash).toMatch(/^0x/);
  });

  it("falls back to name()/DOMAIN_SEPARATOR only when they agree, and never signs a guessed domain", async () => {
    // A pre-ERC-5267 token whose DOMAIN_SEPARATOR matches name() + version "1".
    const good = TypedDataEncoder.hashDomain({ name: "Legacy Dollar", version: "1", chainId: 10143, verifyingContract: AUSD.monadTestnet });
    const ok = createFakeWallet(AUSD.monadTestnet, PAYMENTS, { domain: null, legacyName: "Legacy Dollar", domainSeparator: good });
    await expect(client(ok.provider).pay({ merchant: MERCHANT, amount: "1.00", orderId: "o-9" })).resolves.toMatchObject({ ok: true });

    // AUSD's trap: name() says "AUSD" but the domain name is "Agora Dollar". Refuse.
    const trap = createFakeWallet(AUSD.monadTestnet, PAYMENTS, {
      domain: null,
      legacyName: "AUSD",
      domainSeparator: "0x7ff7d6b4bdc3e260c85cf89f8779b1ac80120e3c277f7db4900739a507f03ea1",
    });
    const result = await client(trap.provider).pay({ merchant: MERCHANT, amount: "1.00", orderId: "o-10" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/refusing to sign against a guess/);
    expect(trap.methods()).not.toContain("eth_signTypedData_v4");
  });
});

describe("pay(): gasless through the relayer", () => {
  it("POSTs the signed authorization to relayUrl and never asks the wallet to send", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    const txHash = `0x${"cd".repeat(32)}`;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { txHash, status: "confirmed" } }), { status: 201 }));
    const result = await client(fake.provider, { relayUrl: "http://localhost:3100/api/v1/relay/payments", fetch }).pay({
      merchant: MERCHANT,
      amount: "25.00",
      orderId: "INV-2041",
    });

    expect(result).toMatchObject({ ok: true, relayed: true, transactionHash: txHash });
    expect(fake.methods()).not.toContain("eth_sendTransaction");
    expect(fake.methods()).not.toContain("eth_getTransactionReceipt");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3100/api/v1/relay/payments");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer pk_test_51Hx8yQfT3sLk2Pz",
      "Polaris-Client": "polarispay-sdk/0.3.0",
    });
    const body = JSON.parse(init.body as string);
    const typed = fake.signed[0]!;
    expect(body).toEqual({
      type: "payWithAuthorization",
      chainId: 10143,
      contract: PAYMENTS,
      payer: fake.wallet.address,
      merchant: MERCHANT,
      amount: "25000000",
      orderId: "INV-2041",
      validAfter: "0",
      validBefore: typed.message.validBefore,
      nonce: paymentId(MERCHANT, "INV-2041"),
      signature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
    });
    // The relayer gets a signature it can verify on its own.
    expect(verifyTypedData(typed.domain, RECEIVE_WITH_AUTHORIZATION_TYPES as never, typed.message, body.signature)).toBe(fake.wallet.address);
  });

  it("waits for the receipt when the relayer only submitted", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { txHash: `0x${"ef".repeat(32)}`, status: "submitted" } }), { status: 200 }));
    const result = await client(fake.provider, { relayUrl: "https://relay.example/pay", fetch }).pay({ merchant: MERCHANT, amount: "1.00", orderId: "o-11" });
    expect(result.ok).toBe(true);
    expect(fake.methods()).toContain("eth_getTransactionReceipt");
  });

  it("passes the relayer's refusal through as the buyer's error", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "merchant_inactive", message: "This merchant isn't accepting payments yet." } }), { status: 422 }),
    );
    const result = await client(fake.provider, { relayUrl: "https://relay.example/pay", fetch }).pay({ merchant: MERCHANT, amount: "1.00", orderId: "o-12" });
    expect(result).toMatchObject({ ok: false, error: "This merchant isn't accepting payments yet." });
    expect((result.cause as PolarisError).code).toBe("merchant_inactive");
  });
});

describe("pay(): configuration", () => {
  it("refuses the undeployed Monad preset instead of signing for a zero address", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    const polaris = createPolaris({ publishableKey: "pk_test_51Hx8yQfT3sLk2Pz", provider: fake.provider });
    expect(polaris.chain.chainId).toBe(10143);
    await expect(polaris.pay({ merchant: MERCHANT, amount: "1.00", orderId: "o-13" })).rejects.toMatchObject({
      type: "configuration_error",
      code: "contract_not_deployed",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("validates the merchant and order id", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS);
    await expect(client(fake.provider).pay({ merchant: "0x123", amount: "1.00", orderId: "o" })).rejects.toMatchObject({ code: "invalid_merchant" });
    await expect(client(fake.provider).pay({ merchant: MERCHANT, amount: "1.00", orderId: "" })).rejects.toMatchObject({ code: "invalid_order_id" });
  });

  it("reads the recorded payment for an order", async () => {
    const fake = createFakeWallet(AUSD.monadTestnet, PAYMENTS, {
      paid: { payer: MERCHANT, merchant: MERCHANT, amount: 25_000_000n, paidAt: 1_790_000_000n },
    });
    await expect(client(fake.provider).getPayment({ merchant: MERCHANT, orderId: "INV-2041" })).resolves.toEqual({
      paymentId: paymentId(MERCHANT, "INV-2041"),
      payer: MERCHANT,
      merchant: MERCHANT,
      amount: "25.00",
      paidAt: new Date(1_790_000_000_000),
    });
  });
});
