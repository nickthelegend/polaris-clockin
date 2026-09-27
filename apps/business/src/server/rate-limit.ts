import "server-only";

/**
 * Writes per merchant: a token bucket of 30, refilled at one every two
 * seconds. Generous for a person clicking through the dashboard, tight
 * enough that a script can't grow the store without bound.
 *
 * In memory, like the store: per server instance. The database-backed store
 * should move this next to it (or to the edge) so every instance shares it.
 */

const CAPACITY = 30;
const REFILL_PER_SECOND = 0.5;
const MAX_TRACKED = 10_000;

const buckets = new Map<string, { tokens: number; at: number }>();

/** Take one write token for this merchant. Returns 0 when allowed, otherwise the seconds to wait. */
export function takeWriteToken(merchantId: string, now = Date.now()): number {
  const bucket = buckets.get(merchantId) ?? { tokens: CAPACITY, at: now };
  const refilled = Math.min(CAPACITY, bucket.tokens + ((now - bucket.at) / 1000) * REFILL_PER_SECOND);
  if (refilled < 1) {
    buckets.set(merchantId, { tokens: refilled, at: now });
    return Math.ceil((1 - refilled) / REFILL_PER_SECOND);
  }
  if (buckets.size >= MAX_TRACKED && !buckets.has(merchantId)) buckets.clear();
  buckets.set(merchantId, { tokens: refilled - 1, at: now });
  return 0;
}
