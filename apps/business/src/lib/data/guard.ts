import type { IsoDate } from "./types";

/**
 * The credit guard: the Chainlink CRE `polaris-guardian` workflow's verdict
 * on the credit pool, as GuardianReceiver keeps it on chain and
 * PolarisCheckout.openPlan applies it. When it says credit is paused, new Pay
 * in 4 plans are refused; Pay now, Send and Subscribe never ask it. A guard
 * that stopped reporting (older than its `maxAttestationAge`) fails open, so
 * Pay in 4 keeps working and the screens say when it last checked.
 *
 * These are the shapes the API serves (`GET /api/public/credit-guard`, the
 * dashboard's `GET /api/chainlink`) and the pure helpers that read them, safe
 * in the browser and on the server.
 */

/** GuardianReceiver's reason bits, by name. */
export type GuardReason = "depeg" | "low_cash" | "bad_debt" | "stale_price" | "owner_pause";

/** GuardianReceiver.REASON_*: 1, 2, 4, 8 and the owner's 0x80. */
export const GUARD_REASON_BITS: Readonly<Record<GuardReason, number>> = {
  depeg: 1,
  low_cash: 2,
  bad_debt: 4,
  stale_price: 8,
  owner_pause: 0x80,
};

/** The reasons a bitmask carries, in bit order. Unknown bits are ignored. */
export function reasonsFromMask(mask: number): GuardReason[] {
  return (Object.keys(GUARD_REASON_BITS) as GuardReason[]).filter((r) => (mask & GUARD_REASON_BITS[r]) !== 0);
}

/** Why credit is paused, in the merchant's words. */
export const GUARD_REASON_TEXT: Readonly<Record<GuardReason, string>> = {
  depeg: "AUSD traded below its floor on Chainlink's AUSD/USD feed",
  low_cash: "The credit pool's free cash fell below its floor",
  bad_debt: "Bad debt passed its share of everything lent",
  stale_price: "Chainlink's AUSD/USD price was too old to trust",
  owner_pause: "Polaris paused Pay in 4 by hand",
};

/** What a buyer reads wherever Pay in 4 is offered while the guard has paused it. */
export const GUARD_PAUSED_MESSAGE = "Pay in 4 is paused by our risk guard; pay now works as usual.";

/**
 * - `open`: a fresh attestation says the pool is healthy (or the owner forced credit open).
 * - `paused`: new Pay in 4 plans are refused now.
 * - `stale`: the latest attestation is older than the guard's `maxAttestationAge`: credit fails open.
 * - `never`: no attestation yet: credit fails open.
 * - `unconfigured`: no guardian is deployed, or PolarisCheckout doesn't ask it.
 * - `unavailable`: the chain couldn't be read just now (PolarisCheckout fails open on the same).
 */
export type CreditGuardState = "open" | "paused" | "stale" | "never" | "unconfigured" | "unavailable";

export type GuardOverride = "none" | "resume" | "pause";

/** One of the guardian's four checks, against today's thresholds. */
export type GuardCheck = {
  key: "price" | "cash" | "bad_debt" | "price_age";
  label: string;
  /** The attested figure, in words ("$0.9998", "$48,210.00", "0.00%", "12 min"). */
  value: string;
  /** Its limit, in words ("at least $0.995"). */
  limit: string;
  ok: boolean;
};

export type CreditGuard = {
  state: CreditGuardState;
  /** What PolarisCheckout.openPlan applies right now (`creditPaused()`): true refuses new Pay in 4 plans. */
  paused: boolean;
  reasons: GuardReason[];
  /** GUARD_PAUSED_MESSAGE while paused, else null. */
  message: string | null;
  /** The latest attestation's `observedAt`: when the guard last checked. Null before the first. */
  checkedAt: IsoDate | null;
  /** How old that check was when this was read, by the chain's clock (seconds). */
  ageSeconds: number | null;
  /** Past this age an attestation is stale and credit fails open. */
  maxAgeSeconds: number | null;
  override: GuardOverride;
  /** GuardianReceiver, when one is deployed. */
  guardian: `0x${string}` | null;
  /** Rounds written so far (its feed's latest round id). */
  round: number | null;
  /** When the API read the chain. */
  readAt: IsoDate;
  /** The latest attestation's own verdict (an owner override or staleness is not in it). */
  attested: { paused: boolean; reasons: GuardReason[] } | null;
  thresholds: {
    /** AUSD/USD floor, dollars ("0.995"). */
    minPrice: string;
    minFreeCashUnits: string;
    maxBadDebtBps: number;
    maxPriceAgeSeconds: number;
  } | null;
  attestation: {
    /** The Chainlink AUSD/USD round the workflow cited, and its answer in dollars. */
    priceRoundId: string;
    price: string;
    priceUpdatedAt: IsoDate | null;
    freeCashUnits: string;
    totalOwedUnits: string;
    badDebtUnits: string;
    totalOriginatedUnits: string;
    observedAt: IsoDate;
  } | null;
  checks: GuardCheck[];
  /**
   * GuardianReceiver read as a feed (AggregatorV3Interface `latestRoundData`):
   * "Polaris pool health, computed by CRE": what the pool can lend now, in
   * dollars (free cash at the attested AUSD price; 0 when the attestation
   * paused credit). A Polaris attestation computed by a CRE workflow, not a
   * Chainlink Data Feed and not Proof of Reserve.
   */
  feed: {
    address: `0x${string}`;
    description: string;
    decimals: number;
    roundId: string;
    /** The raw answer, `decimals` decimals. */
    answer: string;
    /** The same in dollars ("48,210.36"). */
    answerUsd: string;
    updatedAt: IsoDate | null;
  } | null;
  /** The price feed the workflow reads: Chainlink AUSD/USD on Monad mainnet, or a labelled local stand-in. */
  priceFeed: { chainId: number | null; address: `0x${string}`; description: string; kind: "chainlink" | "mock" } | null;
};

/** Seconds since the guard last checked, as of `now`, from what the API read at `readAt`. */
export function guardAgeSeconds(guard: Pick<CreditGuard, "ageSeconds" | "readAt">, now = Date.now()): number | null {
  if (guard.ageSeconds === null) return null;
  const since = Math.max(0, Math.floor((now - Date.parse(guard.readAt)) / 1000));
  return guard.ageSeconds + since;
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function checkedAgo(seconds: number): string {
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** "Last checked 4 min ago", or null before the first check. */
export function lastCheckedLine(guard: Pick<CreditGuard, "ageSeconds" | "readAt">, now = Date.now()): string | null {
  const age = guardAgeSeconds(guard, now);
  return age === null ? null : `Last checked ${checkedAgo(age)}`;
}

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 6-decimal stablecoin units as "$1,234.56" (truncated to the cent). */
export function unitsToUsd(units: string | bigint): string {
  const u = typeof units === "bigint" ? units : BigInt(units);
  const negative = u < 0n;
  const cents = (negative ? -u : u) / 10_000n;
  const text = DOLLARS.format(Number(cents) / 100);
  return negative ? `−${text}` : text;
}

/** A fixed-point integer with `decimals` decimals as a decimal string, trailing zeros trimmed to `min` places. */
export function fixed(value: bigint, decimals: number, min = 2): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < min) frac = frac.padEnd(min, "0");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

function duration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h`;
}

/**
 * The guardian's four checks for an attestation under `thresholds`: the same
 * formula as GuardianReceiver.evaluate (and lib/cre.js `guardianReasons`),
 * with the figures in words. `ok: false` on exactly the reasons evaluate()
 * would set.
 */
export function guardChecks(
  a: { price: bigint; priceUpdatedAt: bigint; freeCash: bigint; badDebt: bigint; totalOriginated: bigint; observedAt: bigint },
  t: { minPrice: bigint; minFreeCash: bigint; maxBadDebtBps: number; maxPriceAge: number },
): GuardCheck[] {
  const badDebtLimit = (a.totalOriginated * BigInt(t.maxBadDebtBps)) / 10_000n;
  const priceAge = a.observedAt > a.priceUpdatedAt ? a.observedAt - a.priceUpdatedAt : 0n;
  const priceStale = a.priceUpdatedAt === 0n || priceAge > BigInt(t.maxPriceAge);
  const share = a.totalOriginated === 0n ? 0 : Number((a.badDebt * 1_000_000n) / a.totalOriginated) / 10_000;
  return [
    { key: "price", label: "AUSD/USD", value: `$${fixed(a.price, 8, 4)}`, limit: `at least $${fixed(t.minPrice, 8, 3)}`, ok: a.price >= t.minPrice },
    { key: "cash", label: "Free pool cash", value: unitsToUsd(a.freeCash), limit: `at least ${unitsToUsd(t.minFreeCash)}`, ok: a.freeCash >= t.minFreeCash },
    {
      key: "bad_debt",
      label: "Bad debt",
      value: `${share.toFixed(2)}% of lent`,
      limit: `at most ${(t.maxBadDebtBps / 100).toFixed(2).replace(/\.00$/, "")}%`,
      ok: a.badDebt <= badDebtLimit,
    },
    {
      key: "price_age",
      label: "Price age",
      value: a.priceUpdatedAt === 0n ? "no price" : duration(Number(priceAge)),
      limit: `at most ${duration(t.maxPriceAge)}`,
      ok: !priceStale,
    },
  ];
}
