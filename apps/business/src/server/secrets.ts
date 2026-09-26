import "server-only";

import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A uniformly random base62 string from the OS CSPRNG. */
export function randomBase62(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[randomInt(0, BASE62.length)];
  return out;
}

export function newId(prefix: string, length = 14): string {
  return `${prefix}_${randomBase62(length)}`;
}

/** A 32-byte hex nonce, e.g. for an ERC-3009 authorisation. */
export function randomNonce32(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

/* ── API keys ───────────────────────────────────────────────────────────── */

/** Everything is test mode until mainnet: the prefixes say so, as Stripe's do. */
export const PUBLISHABLE_PREFIX = "pk_test_";
export const SECRET_PREFIX = "sk_test_";
export const WEBHOOK_SECRET_PREFIX = "whsec_";

export function newPublishableKey(): string {
  return PUBLISHABLE_PREFIX + randomBase62(24);
}

export function newSecretKey(): string {
  return SECRET_PREFIX + randomBase62(40);
}

export function newWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBase62(32);
}

/**
 * Hash a secret key for storage. HMAC-SHA256 under `POLARIS_KEY_PEPPER` when
 * it is set, so a leaked table alone can't be used to test guesses; plain
 * SHA-256 otherwise. A 40-character base62 secret carries ~238 bits, so no
 * slow KDF is needed.
 */
export function hashSecret(secret: string): string {
  const pepper = process.env.POLARIS_KEY_PEPPER;
  return pepper
    ? `hmac256:${createHmac("sha256", pepper).update(secret).digest("hex")}`
    : `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

/** `sk_test_…a1b2`: enough to recognise a key, never enough to use it. */
export function hint(secret: string, prefix: string): string {
  return `${prefix}…${secret.slice(-4)}`;
}

/* ── Webhook signatures ─────────────────────────────────────────────────── */

/**
 * `t=<unix>,v1=<hex>` over `${t}.${body}`: the same scheme as
 * packages/db/src/webhooks.ts, so a receiver verifies test and live events with
 * one function.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}
