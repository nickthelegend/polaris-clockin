/**
 * What `polaris-guardian` attests, and how it decides: pure, so the unit tests
 * hold it to GuardianReceiver byte for byte and verdict for verdict.
 *
 * Report body (GuardianReceiver, packages/contracts/contracts/cre/GuardianReceiver.sol):
 *
 *   abi.encode(uint8 kind = 3, Attestation a)
 *   Attestation = (uint80 priceRoundId, int256 price, uint64 priceUpdatedAt,
 *                  uint256 freeCash, uint256 totalOwed, uint256 badDebt,
 *                  uint256 totalOriginated, uint64 observedAt,
 *                  bool creditPaused, uint8 reasons)
 *
 * `price`, `priceRoundId` and `priceUpdatedAt` are one round of Chainlink's
 * AUSD/USD feed on Monad mainnet (8 decimals), cited as read, so anyone can
 * look the round up. The pool figures are PolarisLoanEngine.poolState() on
 * Monad testnet at the block whose timestamp is `observedAt`.
 *
 * The verdict is a bitmask, and `creditPaused == (reasons != 0)`:
 *
 *   1  depeg        price < minPrice, or price > maxPrice
 *   2  low cash     freeCash < minFreeCash
 *   4  bad debt     totalOriginated >= minOriginated, and bad debt beyond what the
 *                   owner acknowledged > floor(totalOriginated * maxBadDebtBps / 10000)
 *   8  stale price  priceUpdatedAt == 0, or observedAt - priceUpdatedAt > maxPriceAge
 *
 * GuardianReceiver.evaluate is the same formula, and the receiver refuses a
 * report whose verdict differs from its own (`VerdictMismatch`), so the two
 * computations check each other. It also refuses one whose low-cash and
 * bad-debt bits are not the live pool's (`PoolMismatch`): those two it reads
 * from the pool itself whenever PolarisCheckout asks, so what the DON is
 * trusted for is the price, the one input from another chain.
 * `guardianReasons` below is held to packages/contracts/lib/cre.js
 * `guardianReasons` (which the contract suite fuzzes against `evaluate`) on
 * random inputs in test/guardian.test.ts, and to the contract itself in the
 * local end-to-end run.
 */

import { decodeAbiParameters, encodeAbiParameters, type Hex, parseAbiParameters } from "viem";

export const REPORT_KIND_GUARDIAN = 3;

/** Decimals of the AUSD/USD price a report carries, and of the receiver's feed-shaped view. */
export const PRICE_DECIMALS = 8;

export const REASON = {
  DEPEG: 1,
  LOW_CASH: 2,
  BAD_DEBT: 4,
  STALE_PRICE: 8,
  /** Only in GuardianReceiver.isCreditPaused / creditStatus: the owner forced a pause. Never in a report. */
  OWNER_PAUSE: 0x80,
} as const;

/** The reasons GuardianReceiver takes from the attestation: the price, read on Monad mainnet. */
export const PRICE_REASONS = REASON.DEPEG | REASON.STALE_PRICE;
/** The reasons GuardianReceiver reads from the pool itself, live (a report must agree with them). */
export const POOL_REASONS = REASON.LOW_CASH | REASON.BAD_DEBT;

const REASON_WORDS: ReadonlyArray<[number, string]> = [
  [REASON.DEPEG, "depeg"],
  [REASON.LOW_CASH, "low_cash"],
  [REASON.BAD_DEBT, "bad_debt"],
  [REASON.STALE_PRICE, "stale_price"],
  [REASON.OWNER_PAUSE, "owner_pause"],
];

/** GuardianReceiver.Override. */
export const OVERRIDE = { NONE: 0, FORCE_RESUME: 1, FORCE_PAUSE: 2 } as const;
export const OVERRIDE_NAME: Record<number, string> = { 0: "none", 1: "force_resume", 2: "force_pause" };

/** The words for each bit set in `mask`, lowest bit first: `[]` when healthy. */
export function reasonNames(mask: number): string[] {
  return REASON_WORDS.filter(([bit]) => (mask & bit) !== 0).map(([, word]) => word);
}

/** PolarisLoanEngine.poolState(), stablecoin base units. */
export interface PoolState {
  freeCash: bigint;
  totalOwed: bigint;
  badDebt: bigint;
  totalOriginated: bigint;
}

/** GuardianReceiver.thresholds(): the policy, set by the owner on chain. */
export interface Thresholds {
  /** Lowest AUSD/USD that is not a depeg, PRICE_DECIMALS decimals. */
  minPrice: bigint;
  /** Highest AUSD/USD that is not a depeg (an upward break, or a faulty answer), PRICE_DECIMALS decimals. */
  maxPrice: bigint;
  /** Least free pool cash, stablecoin base units. */
  minFreeCash: bigint;
  /** Most bad debt, in basis points of lifetime originations. */
  maxBadDebtBps: number;
  /** Lifetime originations, base units, below which the bad-debt ratio is not applied. */
  minOriginated: bigint;
  /** Oldest the cited price may be at observation, seconds. */
  maxPriceAge: number;
}

/** One round of the AUSD/USD feed, as `latestRoundData()` returned it. */
export interface PriceRound {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
}

export interface Attestation extends PoolState {
  priceRoundId: bigint;
  price: bigint;
  priceUpdatedAt: bigint;
  observedAt: bigint;
  creditPaused: boolean;
  reasons: number;
}

export const GUARDIAN_REPORT_PARAMS = parseAbiParameters(
  "uint8 kind, (uint80 priceRoundId, int256 price, uint64 priceUpdatedAt, uint256 freeCash, uint256 totalOwed, uint256 badDebt, uint256 totalOriginated, uint64 observedAt, bool creditPaused, uint8 reasons) attestation",
);

export function encodeGuardianReport(a: Attestation): Hex {
  return encodeAbiParameters(GUARDIAN_REPORT_PARAMS, [
    REPORT_KIND_GUARDIAN,
    {
      priceRoundId: a.priceRoundId,
      price: a.price,
      priceUpdatedAt: a.priceUpdatedAt,
      freeCash: a.freeCash,
      totalOwed: a.totalOwed,
      badDebt: a.badDebt,
      totalOriginated: a.totalOriginated,
      observedAt: a.observedAt,
      creditPaused: a.creditPaused,
      reasons: a.reasons,
    },
  ]);
}

export function decodeGuardianReport(hex: Hex): { kind: number; attestation: Attestation } {
  const [kind, a] = decodeAbiParameters(GUARDIAN_REPORT_PARAMS, hex);
  return { kind, attestation: { ...a } };
}

/**
 * GuardianReceiver's pool reasons (low cash, bad debt) for `pool` under `t`,
 * counting only bad debt beyond `badDebtAcknowledged` (`acknowledgeBadDebt`).
 */
export function poolReasons(
  pool: Pick<PoolState, "freeCash" | "badDebt" | "totalOriginated">,
  t: Thresholds,
  badDebtAcknowledged = 0n,
): number {
  let reasons = 0;
  if (pool.freeCash < t.minFreeCash) reasons |= REASON.LOW_CASH;
  if (pool.totalOriginated >= t.minOriginated) {
    const unacknowledged = pool.badDebt > badDebtAcknowledged ? pool.badDebt - badDebtAcknowledged : 0n;
    // Math.mulDiv floors, and bad debt is an integer, so this comparison is exact.
    if (unacknowledged > (pool.totalOriginated * BigInt(t.maxBadDebtBps)) / 10_000n) reasons |= REASON.BAD_DEBT;
  }
  return reasons;
}

/** GuardianReceiver's price reasons (depeg below or above the band, stale price) for the attested round. */
export function priceReasons(a: Pick<Attestation, "price" | "priceUpdatedAt" | "observedAt">, t: Thresholds): number {
  let reasons = 0;
  if (a.price < t.minPrice || a.price > t.maxPrice) reasons |= REASON.DEPEG;
  if (a.priceUpdatedAt === 0n || (a.observedAt > a.priceUpdatedAt && a.observedAt - a.priceUpdatedAt > BigInt(t.maxPriceAge))) {
    reasons |= REASON.STALE_PRICE;
  }
  return reasons;
}

/** GuardianReceiver.evaluate: the reason bits for `a` under `t` and the acknowledged bad debt, 0 when healthy. */
export function guardianReasons(
  a: Pick<Attestation, "price" | "freeCash" | "badDebt" | "totalOriginated" | "priceUpdatedAt" | "observedAt">,
  t: Thresholds,
  badDebtAcknowledged = 0n,
): number {
  return poolReasons(a, t, badDebtAcknowledged) | priceReasons(a, t);
}

/** The whole attestation, its verdict filled in the way GuardianReceiver requires. */
export function buildAttestation(
  p: { round: PriceRound; pool: PoolState; observedAt: bigint },
  t: Thresholds,
  badDebtAcknowledged = 0n,
): Attestation {
  const a = {
    priceRoundId: p.round.roundId,
    price: p.round.answer,
    priceUpdatedAt: p.round.updatedAt,
    freeCash: p.pool.freeCash,
    totalOwed: p.pool.totalOwed,
    badDebt: p.pool.badDebt,
    totalOriginated: p.pool.totalOriginated,
    observedAt: p.observedAt,
  };
  const reasons = guardianReasons(a, t, badDebtAcknowledged);
  return { ...a, creditPaused: reasons !== 0, reasons };
}

/** int192's largest value: GuardianReceiver's round answer saturates there. */
export const INT192_MAX = (1n << 191n) - 1n;

/**
 * What GuardianReceiver's feed-shaped view answers for an accepted
 * attestation: the pool's free cash when the report lands (`freeCash`, which
 * the receiver reads from the pool, not the report; the attestation's own by
 * default) in US dollars at the attested price, with PRICE_DECIMALS decimals,
 * or 0 when the attestation paused credit. Saturates at int192's maximum, as
 * the receiver does. `cashScale` is 10 ** the stablecoin's decimals.
 */
export function lendableUsd(
  a: Pick<Attestation, "freeCash" | "price" | "creditPaused">,
  cashScale: bigint,
  freeCash: bigint = a.freeCash,
): bigint {
  if (a.creditPaused || a.price <= 0n) return 0n;
  const usd = (freeCash * a.price) / cashScale;
  return usd > INT192_MAX ? INT192_MAX : usd;
}

/** GuardianReceiver.creditStatus(), trimmed to what the write policy and the result use. */
export interface GuardState {
  /** What PolarisCheckout.openPlan applies now (owner override, the live pool and staleness included). */
  paused: boolean;
  reasons: number;
  attestedPaused: boolean;
  attestedReasons: number;
  /** The latest attestation's observedAt; 0 when there is none. */
  observedAt: bigint;
  /** No attestation, or older than maxAttestationAge: its price reasons fail open. */
  stale: boolean;
  /** The override in force now (a forced resume past its end reads NONE). */
  overrideMode: number;
  maxAttestationAge: number;
  round: bigint;
  /** When the forced resume in force ends; 0 when there is none. */
  overrideUntil?: bigint;
  /** Low cash and bad debt, from the pool now. */
  poolReasons?: number;
  /** Depeg and stale price, from the latest attestation under today's thresholds; 0 once stale. */
  priceReasons?: number;
  badDebtAcknowledged?: bigint;
}

/**
 * When a run writes, like a Chainlink Data Feed's heartbeat and deviation
 * threshold: a write costs gas (Monad bills the limit), so an unchanged
 * verdict is re-attested only when the last one is `heartbeatSeconds` old or
 * the free cash, valued at the price, moved by `deviationBps`. A changed
 * verdict (a pause, a resume, another reason) is always written.
 * `heartbeatSeconds: 0` writes every run.
 */
export interface WritePolicy {
  heartbeatSeconds: number;
  /** 0 turns the deviation trigger off. */
  deviationBps: number;
}

export type WriteWhy = "first" | "verdict" | "stale" | "heartbeat" | "deviation" | "unchanged" | "not-newer";

/**
 * Whether `next` should be written, given the receiver's state and its latest
 * attestation (`previous`, null when there is none).
 *
 *   not-newer   observedAt is not after the latest one: the receiver would
 *               refuse it (`AttestationOutOfOrder`), so nothing is sent
 *   first       nothing attested yet
 *   verdict     the reasons differ from the latest attestation's
 *   stale       the latest attestation is past maxAttestationAge (credit fails open)
 *   heartbeat   the latest attestation is at least heartbeatSeconds old
 *   deviation   free cash x price moved by at least deviationBps
 *   unchanged   none of the above: no write
 */
export function writeDecision(
  next: Attestation,
  state: GuardState,
  previous: Pick<Attestation, "freeCash" | "price" | "reasons"> | null,
  policy: WritePolicy,
): { write: boolean; why: WriteWhy } {
  if (state.observedAt !== 0n && next.observedAt <= state.observedAt) return { write: false, why: "not-newer" };
  if (state.observedAt === 0n || previous === null) return { write: true, why: "first" };
  if (next.reasons !== state.attestedReasons) return { write: true, why: "verdict" };
  if (state.stale) return { write: true, why: "stale" };
  if (next.observedAt - state.observedAt >= BigInt(policy.heartbeatSeconds)) return { write: true, why: "heartbeat" };
  if (policy.deviationBps > 0) {
    const before = previous.freeCash * (previous.price > 0n ? previous.price : 0n);
    const after = next.freeCash * (next.price > 0n ? next.price : 0n);
    const moved = after > before ? after - before : before - after;
    if (before === 0n ? after !== 0n : moved * 10_000n >= before * BigInt(policy.deviationBps)) return { write: true, why: "deviation" };
  }
  return { write: false, why: "unchanged" };
}

/** How credit moves if `next` is accepted, from what openPlan applied before. */
export function transitionOf(next: Attestation, state: GuardState): "first" | "paused" | "resumed" | "reasons-changed" | "unchanged" {
  if (state.observedAt === 0n) return "first";
  if (next.creditPaused && !state.attestedPaused) return "paused";
  if (!next.creditPaused && state.attestedPaused) return "resumed";
  return next.reasons === state.attestedReasons ? "unchanged" : "reasons-changed";
}

/** A fixed-point amount as a decimal string: `formatUnits` without the dependency on float. */
export function decimal(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
