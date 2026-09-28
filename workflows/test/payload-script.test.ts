/**
 * scripts/underwriting-payload.mjs, which `simulate:underwriting` runs first:
 * what it writes must be a payload the workflow accepts, or every CLI
 * simulation of polaris-underwrite ends "rejected".
 */

import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyAccountConsent } from "../src/underwriting/consent.ts";
import { verifyLinkProof } from "../src/underwriting/link.ts";
import { parseUnderwritingPayload } from "../src/underwriting/payload.ts";
// @ts-expect-error: a plain ESM script, no type declarations
import { underwritingPayload } from "../scripts/underwriting-payload.mjs";

// Test-only keys (Hardhat's public defaults).
const ACCOUNT_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const WALLET_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const NOW = 1_790_424_000;
const CHAIN = 10_143;

const bytes = (p: unknown) => new TextEncoder().encode(JSON.stringify(p));

test("the account alone: its consent verifies as the workflow verifies it", async () => {
  const payload = await underwritingPayload({ accountKey: ACCOUNT_KEY, chainId: CHAIN, issuedAt: NOW });
  const input = parseUnderwritingPayload(bytes(payload));
  expect(input.user).toBe(privateKeyToAccount(ACCOUNT_KEY).address);
  expect(input.linked).toBeUndefined();
  expect(verifyAccountConsent({ account: input.user, wallet: null, chainId: CHAIN, ...input.consent }, NOW + 60)).toEqual({ ok: true });
});

test("with a history wallet: the consent names it and the wallet's link proof verifies", async () => {
  const payload = await underwritingPayload({ accountKey: ACCOUNT_KEY, walletKey: WALLET_KEY, chainId: CHAIN, issuedAt: NOW });
  const input = parseUnderwritingPayload(bytes(payload));
  const wallet = privateKeyToAccount(WALLET_KEY).address;
  expect(input.linked?.wallet).toBe(wallet);
  expect(verifyAccountConsent({ account: input.user, wallet, chainId: CHAIN, ...input.consent }, NOW + 60)).toEqual({ ok: true });
  expect(verifyLinkProof({ account: input.user, ...input.linked! }, NOW + 60)).toEqual({ ok: true });
  // Signed for this chain only.
  expect(verifyAccountConsent({ account: input.user, wallet, chainId: 143, ...input.consent }, NOW + 60).ok).toBe(false);
});

test("refuses a key that is not 32 bytes of hex rather than sign with something else", async () => {
  await expect(underwritingPayload({ accountKey: "0x1234", chainId: CHAIN, issuedAt: NOW })).rejects.toThrow(/account key/);
  await expect(underwritingPayload({ accountKey: ACCOUNT_KEY, walletKey: "nope", chainId: CHAIN, issuedAt: NOW })).rejects.toThrow(/wallet key/);
});
