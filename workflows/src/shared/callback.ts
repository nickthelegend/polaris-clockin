/**
 * The workflow's report to the Polaris API: what a run did, signed so the API
 * can trust it, for the parts the chain cannot do itself (dunning messages,
 * merchant webhooks).
 *
 * Signed like the merchant webhooks in packages/db/src/webhooks.ts and like
 * Stripe's: `Polaris-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
 * Signing the timestamp with the body bounds replay; `id` makes delivery
 * idempotent, because every node of the DON may send it (CRE's response
 * cache usually collapses that to one request, but only usually).
 *
 * This module is pure (no Node APIs): the workflow signs with it inside the
 * WASM runtime, and the API verifies with the same code.
 */

import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const SIGNATURE_HEADER = "Polaris-Signature";

/** How far a callback's timestamp may be from the receiver's clock, in seconds. */
export const CALLBACK_TOLERANCE_SECONDS = 300;

export function signCallback(secret: string, body: string, timestamp: number): string {
  if (!secret) throw new Error("callback secret is empty");
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${bytesToHex(mac)}`;
}

/** Constant-time over the hex strings, since this module cannot use node:crypto. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Check a `Polaris-Signature` header against the raw body. */
export function verifyCallback(
  secret: string,
  body: string,
  header: string | null | undefined,
  nowSeconds: number,
  toleranceSeconds = CALLBACK_TOLERANCE_SECONDS,
): { ok: true; timestamp: number } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = new Map<string, string>();
  for (const p of header.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isSafeInteger(t) || !v1) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = signCallback(secret, body, t).split("v1=")[1]!;
  return sameHex(expected, v1.toLowerCase()) ? { ok: true, timestamp: t } : { ok: false, reason: "signature mismatch" };
}

/** Base64 of a UTF-8 string, for CRE's HTTP request body (a proto `bytes`). */
export function base64Utf8(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}
