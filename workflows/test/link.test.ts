/**
 * The Bring-your-history proof, checked the way the workflow checks it:
 * synchronously, with @noble/curves, against @polarispay/underwriting's
 * `linkMessage` text. Held to viem's own (async) verifier.
 */

import { describe, expect, test } from "bun:test";
import { linkMessage } from "@polarispay/underwriting/core";
import { type Hex, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { recoverPersonalSigner, verifyLinkProof } from "../src/underwriting/link.ts";

const wallet = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const account = "0x00000000000000000000000000000000000ac001" as const;
const NOW = 1_790_424_000;

async function signed(over: Partial<{ account: Hex; issuedAt: number; nonce: string }> = {}) {
  const p = { account: (over.account ?? account) as `0x${string}`, wallet: wallet.address, issuedAt: over.issuedAt ?? NOW - 30, nonce: over.nonce ?? "abcDEF123_-" };
  const signature = await wallet.signMessage({ message: linkMessage(p) });
  return { ...p, signature };
}

describe("verifyLinkProof", () => {
  test("accepts the wallet's own fresh signature, as viem's verifier does", async () => {
    const p = await signed();
    expect(verifyLinkProof(p, NOW)).toEqual({ ok: true });
    expect(await verifyMessage({ address: wallet.address, message: linkMessage(p), signature: p.signature })).toBe(true);
    expect(recoverPersonalSigner(linkMessage(p), p.signature)).toBe(wallet.address);
  });

  test("refuses a proof made for another Polaris account", async () => {
    const p = await signed({ account: "0x00000000000000000000000000000000000ac002" });
    expect(verifyLinkProof({ ...p, account }, NOW)).toEqual({ ok: false, reason: "the link proof was not signed by the wallet" });
  });

  test("refuses a proof older than 15 minutes, or from the future", async () => {
    expect(verifyLinkProof(await signed({ issuedAt: NOW - 901 }), NOW).ok).toBe(false);
    expect(verifyLinkProof(await signed({ issuedAt: NOW + 120 }), NOW).ok).toBe(false);
  });

  test("refuses a wallet claiming itself, a bad nonce and garbage signatures", async () => {
    const p = await signed();
    expect(verifyLinkProof({ ...p, account: wallet.address }, NOW).ok).toBe(false);
    expect(verifyLinkProof({ ...p, nonce: "short" }, NOW).ok).toBe(false);
    expect(verifyLinkProof({ ...p, signature: `0x${"00".repeat(65)}` }, NOW).ok).toBe(false);
  });

  test("refuses the malleable high-s twin of a valid signature", async () => {
    const p = await signed();
    const sig = p.signature.slice(2);
    const s = BigInt(`0x${sig.slice(64, 128)}`);
    const highS = (secp256k1.CURVE.n - s).toString(16).padStart(64, "0");
    const v = Number.parseInt(sig.slice(128, 130), 16) === 27 ? "1c" : "1b";
    const twin = `0x${sig.slice(0, 64)}${highS}${v}` as Hex;
    expect(verifyLinkProof({ ...p, signature: twin }, NOW).ok).toBe(false);
  });
});
