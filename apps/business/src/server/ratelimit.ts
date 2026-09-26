import "server-only";

import { HttpError } from "./http";

/**
 * Token buckets, in memory, per key (an IP, an API key, a signing account).
 *
 * The relayer pays gas for every request it accepts, so it must not be a free
 * faucet for spam: each bucket refills at `perMinute` and holds at most
 * `burst`. Per-process: behind several instances the effective limit is
 * multiplied, which is acceptable for abuse control (money is protected by
 * signatures, not by this).
 */

type Bucket = { tokens: number; updatedMs: number };

export type Limit = { name: string; perMinute: number; burst: number };

export const LIMITS = {
  relayPerIp: { name: "relay-ip", perMinute: 30, burst: 15 },
  relayPerSigner: { name: "relay-signer", perMinute: 12, burst: 6 },
  publicPerIp: { name: "public-ip", perMinute: 240, burst: 60 },
  apiPerKey: { name: "api-key", perMinute: 300, burst: 100 },
  onboardPerMerchant: { name: "onboard", perMinute: 6, burst: 3 },
} as const satisfies Record<string, Limit>;

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

/** Take one token or throw a 429 with Retry-After. */
export function consume(limit: Limit, key: string, nowMs = Date.now()): void {
  const id = `${limit.name}:${key}`;
  const ratePerMs = limit.perMinute / 60_000;
  let b = buckets.get(id);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    b = { tokens: limit.burst, updatedMs: nowMs };
    buckets.set(id, b);
  }
  b.tokens = Math.min(limit.burst, b.tokens + (nowMs - b.updatedMs) * ratePerMs);
  b.updatedMs = nowMs;
  if (b.tokens < 1) {
    const retryAfter = Math.max(1, Math.ceil((1 - b.tokens) / ratePerMs / 1000));
    throw new HttpError(429, "rate_limited", "Too many requests. Try again in a moment.", { headers: { "Retry-After": String(retryAfter) } });
  }
  b.tokens -= 1;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
