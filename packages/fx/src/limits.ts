/** A rate older than this is treated as missing (26 h: Ethereum FX feeds' 24 h heartbeat plus slack). */
export const FX_MAX_AGE_SECONDS = 26 * 60 * 60;
/** How long a good (or stale) read is kept before the feed is read again. */
export const FX_CACHE_MS = 5 * 60 * 1000;
/** How long a failed read is kept, so a flaky RPC is retried soon but not hammered. */
export const FX_ERROR_CACHE_MS = 30 * 1000;
