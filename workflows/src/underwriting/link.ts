/**
 * "Bring your history" (plan §5.5), checked inside the workflow.
 *
 * The buyer's history wallet signs `linkMessage({ account, wallet, issuedAt, nonce })`
 * from @polarispay/underwriting (an EIP-191 personal message). The DON checks
 * that signature itself before spending a single provider call, because the
 * DON is what attests the facts: an API in front of it is not trusted to have
 * checked. Without this, anyone could claim a famous wallet's history.
 *
 * Synchronous on purpose. viem's `recoverMessageAddress` is async (it
 * imports the curve lazily), and a CRE handler runs capability calls
 * synchronously inside QuickJS, so the recovery uses @noble/curves directly,
 * the same library viem uses underneath.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { LINK_PROOF_MAX_AGE, linkMessage, linkProofStaleness } from "@polarispay/underwriting/core";
import { type Address, getAddress, hashMessage, type Hex, isAddress, keccak256, parseSignature } from "viem";

export interface LinkProofInput {
  account: Address;
  wallet: Address;
  issuedAt: number;
  nonce: string;
  signature: Hex;
}

export type LinkCheck = { ok: true } | { ok: false; reason: string };

/** The address that signed `message` (EIP-191), synchronously. */
export function recoverPersonalSigner(message: string, signature: Hex): Address {
  const { r, s, v, yParity } = parseSignature(signature);
  const recovery = yParity ?? (v !== undefined ? Number(v) - 27 : -1);
  if (recovery !== 0 && recovery !== 1) throw new Error("signature has no recovery bit");
  const digest = hashMessage(message).slice(2);
  const sig = new secp256k1.Signature(BigInt(r), BigInt(s)).addRecoveryBit(recovery);
  if (sig.hasHighS()) throw new Error("signature s is not canonical (high s)");
  // Uncompressed point: 04 ‖ x ‖ y. The address is the last 20 bytes of keccak256(x ‖ y).
  const point = sig.recoverPublicKey(digest).toHex(false);
  return getAddress(`0x${keccak256(`0x${point.slice(2)}`).slice(-40)}`);
}

/** Is this a fresh proof, signed by `wallet`, for `account`? */
export function verifyLinkProof(p: LinkProofInput, nowSeconds: number): LinkCheck {
  if (!isAddress(p.account) || !isAddress(p.wallet)) return { ok: false, reason: "account and wallet must be addresses" };
  if (p.account.toLowerCase() === p.wallet.toLowerCase()) return { ok: false, reason: "a wallet cannot link to itself" };
  const stale = linkProofStaleness(p.issuedAt, nowSeconds);
  if (stale) return { ok: false, reason: `link proof ${stale} (at most ${LINK_PROOF_MAX_AGE / 60} minutes)` };
  let message: string;
  try {
    message = linkMessage({ account: p.account, wallet: p.wallet, issuedAt: p.issuedAt, nonce: p.nonce });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  try {
    const signer = recoverPersonalSigner(message, p.signature);
    if (signer.toLowerCase() !== p.wallet.toLowerCase()) {
      return { ok: false, reason: "the link proof was not signed by the wallet" };
    }
  } catch (e) {
    return { ok: false, reason: `unreadable link signature: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true };
}
