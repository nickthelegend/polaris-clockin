/**
 * The account's own consent to be underwritten, checked inside the workflow.
 *
 * `ScoreManager.underwrite` runs once per account: the first report sets the
 * opening line for good. So whoever can fire the trigger must not be able to
 * choose that moment or that evidence for someone else's account: not
 * underwrite a victim alone at the floor before they bring their history, and
 * not link a wallet the attacker owns (liquidations, a sybil cluster) to get
 * the victim declined. The history wallet's link proof (./link.ts) says the
 * wallet agrees; this says the account does.
 *
 * The buyer's Polaris account (a Mera passkey account, a plain EOA) signs
 * `underwriteConsentMessage({ account, wallet, chainId, issuedAt, nonce })`
 * as an EIP-191 personal message. It names the history wallet (or "none"),
 * so a consent to be underwritten alone cannot be used to link a wallet, nor
 * a consent for one wallet to link another; the chain, so a testnet consent
 * does nothing on another network; and its issue time, so it is good for 15
 * minutes (ScoreManager refuses evidence older than that anyway). A replay
 * inside that window repeats a request the account made, and the chain
 * underwrites an account once.
 *
 * The DON checks it itself, before any read or paid call: an API in front of
 * it is not trusted to have checked. The API still authenticates the user
 * before it fires the trigger, so strangers cannot spend the trigger's rate
 * limit, but a compromised or buggy API cannot underwrite an account that did
 * not ask.
 *
 * Pure and synchronous, like ./link.ts, so it runs in the WASM runtime; the
 * Polaris API imports `underwriteConsentMessage` from
 * `@polaris/cre-workflows/consent` to give the app the exact text to sign.
 */

import { LINK_PROOF_MAX_AGE, linkProofStaleness } from "@polarispay/underwriting/core";
import { type Address, type Hex, isAddress } from "viem";
import { type LinkCheck, recoverPersonalSigner } from "./link.ts";

/** How old a consent may be, in seconds: ScoreManager.MAX_EVIDENCE_AGE, like the link proof. */
export const CONSENT_MAX_AGE = LINK_PROOF_MAX_AGE;

export interface ConsentFields {
  /** The Polaris account to underwrite: the signer. */
  account: Address;
  /** The history wallet whose evidence the account agrees to bring, or null for the account alone. */
  wallet: Address | null;
  /** The chain the account and ScoreManager live on (Monad testnet: 10143). */
  chainId: number;
  /** Unix seconds when the app asked for the signature. */
  issuedAt: number;
  /** Random, from the app, so two consents are never the same text. */
  nonce: string;
}

export interface ConsentInput extends ConsentFields {
  /** The account's EIP-191 signature over `underwriteConsentMessage(...)`. */
  signature: Hex;
}

/** The exact text the account signs. */
export function underwriteConsentMessage(p: ConsentFields): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.nonce)) throw new RangeError("nonce must be 8-64 url-safe characters");
  if (!Number.isSafeInteger(p.chainId) || p.chainId <= 0) throw new RangeError("chainId must be a positive integer");
  if (!Number.isFinite(p.issuedAt)) throw new RangeError("issuedAt must be unix seconds");
  const issued = new Date(Math.floor(p.issuedAt) * 1000).toISOString().replace(".000Z", "Z");
  return [
    "Polaris: underwrite this account for Pay in 4 credit, once, from the evidence below.",
    "",
    `Account: ${p.account.toLowerCase()}`,
    `History wallet: ${p.wallet ? p.wallet.toLowerCase() : "none"}`,
    `Chain: ${p.chainId}`,
    `Issued: ${issued}`,
    `Nonce: ${p.nonce}`,
  ].join("\n");
}

/** Did `account` itself ask, recently, to be underwritten with exactly this wallet (or none) on this chain? */
export function verifyAccountConsent(p: ConsentInput, nowSeconds: number): LinkCheck {
  if (!isAddress(p.account)) return { ok: false, reason: "account must be an address" };
  if (p.wallet !== null && !isAddress(p.wallet)) return { ok: false, reason: "wallet must be an address" };
  const stale = linkProofStaleness(p.issuedAt, nowSeconds);
  if (stale) return { ok: false, reason: `account consent ${stale} (at most ${CONSENT_MAX_AGE / 60} minutes)` };
  let message: string;
  try {
    message = underwriteConsentMessage(p);
  } catch (e) {
    return { ok: false, reason: `account consent: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    const signer = recoverPersonalSigner(message, p.signature);
    if (signer.toLowerCase() !== p.account.toLowerCase()) {
      return {
        ok: false,
        reason: "the account did not consent: the consent is not the account's signature over this account, wallet and chain",
      };
    }
  } catch (e) {
    return { ok: false, reason: `unreadable consent signature: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true };
}
