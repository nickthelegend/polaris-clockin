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
 *   1  depeg        price < minPrice
 *   2  low cash     freeCash < minFreeCash
 *   4  bad debt     badDebt > floor(totalOriginated * maxBadDebtBps / 10000)
 *   8  stale price  priceUpdatedAt == 0, or observedAt - priceUpdatedAt > maxPriceAge
 *
 * GuardianReceiver.evaluate is the same formula, and the receiver refuses a
 * report whose verdict differs from its own (`VerdictMismatch`), so the two
 * computations check each other. `guardianReasons` below is held to
 * packages/contracts/lib/cre.js `guardianReasons` (which the contract suite
 * fuzzes against `evaluate`) on random inputs in test/guardian.test.ts, and to
 * the contract itself in the local end-to-end run.
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
  /** Least free pool cash, stablecoin base units. */
  minFreeCash: bigint;
  /** Most bad debt, in basis points of lifetime originations. */
  maxBadDebtBps: number;
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

/** GuardianReceiver.evaluate: the reason bits for `a` under `t`, 0 when healthy. */
export function guardianReasons(
  a: Pick<Attestation, "price" | "freeCash" | "badDebt" | "totalOriginated" | "priceUpdatedAt" | "observedAt">,
  t: Thresholds,
): number {
  let reasons = 0;
  if (a.price < t.minPrice) reasons |= REASON.DEPEG;
  if (a.freeCash < t.minFreeCash) reasons |= REASON.LOW_CASH;
  // Math.mulDiv floors, and bad debt is an integer, so this comparison is exact.
  if (a.badDebt > (a.totalOriginated * BigInt(t.maxBadDebtBps)) / 10_000n) reasons |= REASON.BAD_DEBT;
  if (a.priceUpdatedAt === 0n || (a.observedAt > a.priceUpdatedAt && a.observedAt - a.priceUpdatedAt > BigInt(t.maxPriceAge))) {
    reasons |= REASON.STALE_PRICE;
  }
  return reasons;
}

/** The whole attestation, its verdict filled in the way GuardianReceiver requires. */
export function buildAttestation(p: { round: PriceRound; pool: PoolState; observedAt: bigint }, t: Thresholds): Attestation {
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
  const reasons = guardianReasons(a, t);
  return { ...a, creditPaused: reasons !== 0, reasons };
}

/**
 * What GuardianReceiver's feed-shaped view answers for an accepted
 * attestation: free cash in US dollars at the attested price, with
 * PRICE_DECIMALS decimals, or 0 when the attestation paused credit.
 * `cashScale` is 10 ** the stablecoin's decimals (the receiver's `cashScale()`).
 */
export function lendableUsd(a: Pick<Attestation, "freeCash" | "price" | "creditPaused">, cashScale: bigint): bigint {
  if (a.creditPaused || a.price <= 0n) return 0n;
  return (a.freeCash * a.price) / cashScale;
}

/** GuardianReceiver.creditStatus(), trimmed to what the write policy and the result use. */
export interface GuardState {
  /** What PolarisCheckout.openPlan applies now (owner override and staleness included). */
  paused: boolean;
  reasons: number;
  attestedPaused: boolean;
  attestedReasons: number;
  /** The latest attestation's observedAt; 0 when there is none. */
  observedAt: bigint;
  stale: boolean;
  overrideMode: number;
  maxAttestationAge: number;
  round: bigint;
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
