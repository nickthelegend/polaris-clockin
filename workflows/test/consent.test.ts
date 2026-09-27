/**
 * The account's consent to be underwritten, checked the way the workflow
 * checks it (synchronously, @noble/curves), held to viem's own verifier.
 */

import { describe, expect, test } from "bun:test";
import { type Hex, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONSENT_MAX_AGE, underwriteConsentMessage, verifyAccountConsent } from "../src/underwriting/consent.ts";

// Test-only keys (Hardhat's public defaults).
const account = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const stranger = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
// Lower case: a valid address (a mixed-case one must carry its EIP-55 checksum).
const WALLET = "0x00000000000000000000000000000000000b0b01" as const;
const NOW = 1_790_424_000;
const CHAIN = 10_143;

async function signed(over: Partial<{ wallet: `0x${string}` | null; chainId: number; issuedAt: number; nonce: string; signer: typeof account }> = {}) {
  const fields = {
    account: account.address,
    wallet: over.wallet === undefined ? WALLET : over.wallet,
    chainId: over.chainId ?? CHAIN,
    issuedAt: over.issuedAt ?? NOW - 30,
    nonce: over.nonce ?? "abcDEF123_-",
  };
  const signature = await (over.signer ?? account).signMessage({ message: underwriteConsentMessage(fields) });
  return { ...fields, signature };
}

describe("underwriteConsentMessage", () => {
  test("is the text the app shows and the account signs, byte for byte", () => {
    expect(
      underwriteConsentMessage({ account: account.address, wallet: WALLET, chainId: CHAIN, issuedAt: 1_790_424_000, nonce: "k3J9xq2LmN" }),
    ).toBe(
      [
        "Polaris: underwrite this account for Pay in 4 credit, once, from the evidence below.",
        "",
        `Account: ${account.address.toLowerCase()}`,
        "History wallet: 0x00000000000000000000000000000000000b0b01",
        "Chain: 10143",
        "Issued: 2026-09-26T12:00:00Z",
        "Nonce: k3J9xq2LmN",
      ].join("\n"),
    );
    expect(underwriteConsentMessage({ account: account.address, wallet: null, chainId: CHAIN, issuedAt: NOW, nonce: "k3J9xq2LmN" })).toContain(
      "History wallet: none",
    );
  });

  test("refuses a nonce, chain or time it cannot put in the text", () => {
    const base = { account: account.address, wallet: null, chainId: CHAIN, issuedAt: NOW, nonce: "k3J9xq2LmN" };
    expect(() => underwriteConsentMessage({ ...base, nonce: "short" })).toThrow(/nonce/);
    expect(() => underwriteConsentMessage({ ...base, nonce: "has spaces in it" })).toThrow(/nonce/);
    expect(() => underwriteConsentMessage({ ...base, chainId: 0 })).toThrow(/chainId/);
    expect(() => underwriteConsentMessage({ ...base, issuedAt: Number.NaN })).toThrow(/issuedAt/);
  });
});

describe("verifyAccountConsent", () => {
  test("accepts the account's own fresh signature, as viem's verifier does", async () => {
    const c = await signed();
    expect(verifyAccountConsent(c, NOW)).toEqual({ ok: true });
    expect(await verifyMessage({ address: account.address, message: underwriteConsentMessage(c), signature: c.signature })).toBe(true);
    expect(verifyAccountConsent(await signed({ wallet: null }), NOW)).toEqual({ ok: true });
  });

  test("refuses a signature by any other key", async () => {
    const c = await signed({ signer: stranger });
    expect(verifyAccountConsent(c, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining("the account did not consent") });
  });

  test("binds the wallet: none is not a wallet, and one wallet is not another", async () => {
    const alone = await signed({ wallet: null });
    expect(verifyAccountConsent({ ...alone, wallet: WALLET }, NOW).ok).toBe(false);
    const withWallet = await signed();
    expect(verifyAccountConsent({ ...withWallet, wallet: null }, NOW).ok).toBe(false);
    expect(verifyAccountConsent({ ...withWallet, wallet: "0x00000000000000000000000000000000000b0b02" }, NOW).ok).toBe(false);
  });

  test("binds the chain and the account", async () => {
    const c = await signed();
    expect(verifyAccountConsent({ ...c, chainId: 143 }, NOW).ok).toBe(false);
    expect(verifyAccountConsent({ ...c, account: stranger.address }, NOW).ok).toBe(false);
  });

  test(`is good for ${CONSENT_MAX_AGE / 60} minutes and not from the future`, async () => {
    expect(verifyAccountConsent(await signed({ issuedAt: NOW - CONSENT_MAX_AGE }), NOW).ok).toBe(true);
    expect(verifyAccountConsent(await signed({ issuedAt: NOW - CONSENT_MAX_AGE - 1 }), NOW)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("older than 15 minutes"),
    });
    expect(verifyAccountConsent(await signed({ issuedAt: NOW + 120 }), NOW)).toMatchObject({ ok: false, reason: expect.stringContaining("future") });
  });

  test("refuses garbage signatures and a bad nonce without throwing", async () => {
    const c = await signed();
    expect(verifyAccountConsent({ ...c, signature: `0x${"00".repeat(65)}` as Hex }, NOW).ok).toBe(false);
    expect(verifyAccountConsent({ ...c, nonce: "short" }, NOW).ok).toBe(false);
  });
});
