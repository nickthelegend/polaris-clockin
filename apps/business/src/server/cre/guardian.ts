import "server-only";

import { getAddress, zeroAddress, type Address } from "viem";

import {
  fixed,
  GUARD_PAUSED_MESSAGE,
  guardChecks,
  reasonsFromMask,
  type CreditGuard,
  type CreditGuardState,
  type GuardOverride,
} from "@/lib/data/guard";

import { guardianReceiverAbi, polarisCheckoutAbi } from "../chain/abis";
import { publicClient, requireChain } from "../chain/client";
import type { ChainConfig } from "../env";

/**
 * The credit guard, read from the chain (plan §3.3, decisions 8 to 13).
 *
 * `PolarisCheckout.creditPaused()` is what `openPlan` applies, so it is the
 * one answer to "can a buyer open Pay in 4 now"; GuardianReceiver's views
 * say why: `creditStatus()` (the verdict, the override, staleness),
 * `latestAttestation()` and `thresholds()` (what the CRE workflow saw and
 * what it was judged by), and `latestRoundData()` (pool health read as a
 * feed, "computed by CRE"). One read of all of them per 10 s per process,
 * shared by every caller: the app polls it, the hosted checkout, the shop
 * and the dashboard.
 *
 * It fails open the way the contract does: no guardian, or a read that
 * fails, never reports Pay in 4 as paused.
 */

const TTL_MS = 10_000;

type RawStatus = {
  paused: boolean;
  reasons: number;
  attestedPaused: boolean;
  attestedReasons: number;
  observedAt: bigint;
  stale: boolean;
  overrideMode: number;
  maxAttestationAge: number;
  round: bigint;
};

type RawThresholds = { minPrice: bigint; minFreeCash: bigint; maxBadDebtBps: number; maxPriceAge: number };

type RawAttestation = {
  priceRoundId: bigint;
  price: bigint;
  priceUpdatedAt: bigint;
  freeCash: bigint;
  totalOwed: bigint;
  badDebt: bigint;
  totalOriginated: bigint;
  observedAt: bigint;
  creditPaused: boolean;
  reasons: number;
};

/** Everything one read returns, before it is put in words. */
export type GuardReads = {
  /** PolarisCheckout.creditGuardian(): the guard openPlan asks (zero when none). */
  checkoutGuardian: Address;
  /** PolarisCheckout.creditPaused(): what openPlan applies. */
  gate: { paused: boolean; reasons: number };
  status: RawStatus;
  thresholds: RawThresholds;
  latest: RawAttestation;
  round: { roundId: bigint; answer: bigint; updatedAt: bigint };
  feedDecimals: number;
  feedDescription: string;
  /** The chain's clock: the latest block's timestamp. */
  blockTimestamp: bigint;
};

const OVERRIDES: GuardOverride[] = ["none", "resume", "pause"];

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

/** Tuple or object, as viem returns structs: normalise to the named fields. */
function struct<T>(value: unknown, names: readonly string[]): T {
  if (Array.isArray(value)) return Object.fromEntries(names.map((n, i) => [n, value[i]])) as T;
  return value as T;
}

/** Put one read in words. Pure: tested without a chain. */
export function describeGuard(reads: GuardReads | null, chain: Pick<ChainConfig, "contracts" | "cre">, readAt: Date): CreditGuard {
  const guardian = chain.contracts.guardian;
  const priceFeedRecord = chain.cre?.workflows?.guardian?.priceFeed;
  const priceFeed =
    priceFeedRecord?.address
      ? {
          chainId: priceFeedRecord.chainId ?? null,
          address: getAddress(priceFeedRecord.address),
          description: priceFeedRecord.description ?? "AUSD / USD",
          kind: priceFeedRecord.kind === "mock" ? ("mock" as const) : ("chainlink" as const),
        }
      : null;
  const empty: CreditGuard = {
    state: "unconfigured",
    paused: false,
    reasons: [],
    message: null,
    checkedAt: null,
    ageSeconds: null,
    maxAgeSeconds: null,
    override: "none",
    guardian,
    round: null,
    readAt: readAt.toISOString(),
    attested: null,
    thresholds: null,
    attestation: null,
    checks: [],
    feed: null,
    priceFeed,
  };
  if (!guardian) return empty;
  if (!reads) return { ...empty, state: "unavailable" };
  if (reads.checkoutGuardian === zeroAddress || getAddress(reads.checkoutGuardian) !== getAddress(guardian)) return empty;

  const s = reads.status;
  const observed = s.observedAt > 0n;
  const age = observed ? Math.max(0, Number(reads.blockTimestamp - s.observedAt)) : null;
  // The gate is PolarisCheckout's own answer; the guardian's says why.
  const paused = reads.gate.paused;
  const mask = paused ? reads.gate.reasons : 0;
  let state: CreditGuardState;
  if (paused) state = "paused";
  else if (!observed) state = s.overrideMode === 1 ? "open" : "never";
  else if (s.stale && s.overrideMode !== 1) state = "stale";
  else state = "open";

  const t = reads.thresholds;
  const a = reads.latest;
  return {
    ...empty,
    state,
    paused,
    reasons: reasonsFromMask(mask),
    message: paused ? GUARD_PAUSED_MESSAGE : null,
    checkedAt: observed ? iso(s.observedAt) : null,
    ageSeconds: age,
    maxAgeSeconds: s.maxAttestationAge,
    override: OVERRIDES[s.overrideMode] ?? "none",
    round: Number(s.round),
    attested: observed ? { paused: s.attestedPaused, reasons: reasonsFromMask(s.attestedReasons) } : null,
    thresholds: { minPrice: fixed(t.minPrice, 8, 3), minFreeCashUnits: t.minFreeCash.toString(), maxBadDebtBps: t.maxBadDebtBps, maxPriceAgeSeconds: t.maxPriceAge },
    attestation: observed
      ? {
          priceRoundId: a.priceRoundId.toString(),
          price: fixed(a.price, 8, 4),
          priceUpdatedAt: a.priceUpdatedAt > 0n ? iso(a.priceUpdatedAt) : null,
          freeCashUnits: a.freeCash.toString(),
          totalOwedUnits: a.totalOwed.toString(),
          badDebtUnits: a.badDebt.toString(),
          totalOriginatedUnits: a.totalOriginated.toString(),
          observedAt: iso(a.observedAt),
        }
      : null,
    checks: observed ? guardChecks(a, t) : [],
    feed: {
      address: getAddress(guardian),
      description: reads.feedDescription,
      decimals: reads.feedDecimals,
      roundId: reads.round.roundId.toString(),
      answer: reads.round.answer.toString(),
      answerUsd: Number(fixed(reads.round.answer, reads.feedDecimals, 2)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      updatedAt: reads.round.updatedAt > 0n ? iso(reads.round.updatedAt) : null,
    },
  };
}

/** Read the guard from the chain: every view in one go. Null when there is no guardian. */
async function readGuard(chain: ChainConfig): Promise<GuardReads | null> {
  const guardian = chain.contracts.guardian;
  if (!guardian) return null;
  const client = publicClient();
  const onGuardian = <T>(functionName: string) =>
    client.readContract({ address: guardian, abi: guardianReceiverAbi, functionName: functionName as never }) as Promise<T>;
  const [checkoutGuardian, gate, status, thresholds, latest, round, feedDecimals, feedDescription, block] = await Promise.all([
    client.readContract({ address: chain.contracts.checkout, abi: polarisCheckoutAbi, functionName: "creditGuardian" }) as Promise<Address>,
    client.readContract({ address: chain.contracts.checkout, abi: polarisCheckoutAbi, functionName: "creditPaused" }) as Promise<readonly [boolean, number]>,
    onGuardian<unknown>("creditStatus"),
    onGuardian<unknown>("thresholds"),
    onGuardian<unknown>("latestAttestation"),
    onGuardian<readonly [bigint, bigint, bigint, bigint, bigint]>("latestRoundData"),
    onGuardian<number>("decimals"),
    onGuardian<string>("description"),
    client.getBlock({ blockTag: "latest" }),
  ]);
  return {
    checkoutGuardian,
    gate: { paused: Boolean(gate[0]), reasons: Number(gate[1]) },
    status: struct<RawStatus>(status, ["paused", "reasons", "attestedPaused", "attestedReasons", "observedAt", "stale", "overrideMode", "maxAttestationAge", "round"]),
    thresholds: struct<RawThresholds>(thresholds, ["minPrice", "minFreeCash", "maxBadDebtBps", "maxPriceAge"]),
    latest: struct<RawAttestation>(latest, [
      "priceRoundId",
      "price",
      "priceUpdatedAt",
      "freeCash",
      "totalOwed",
      "badDebt",
      "totalOriginated",
      "observedAt",
      "creditPaused",
      "reasons",
    ]),
    round: { roundId: round[0], answer: round[1], updatedAt: round[3] },
    feedDecimals: Number(feedDecimals),
    feedDescription,
    blockTimestamp: block.timestamp,
  };
}

let cache: { key: string; at: number; value: Promise<CreditGuard> } | null = null;

/** Tests: forget the last read. */
export function resetCreditGuardForTests(): void {
  cache = null;
}

/**
 * The credit guard now, read at most once per 10 s per process. A failed
 * read is `unavailable` (not paused), and isn't cached past the next call.
 */
export async function creditGuard(options: { fresh?: boolean } = {}): Promise<CreditGuard> {
  const chain = requireChain();
  const key = `${chain.id}:${chain.contracts.guardian ?? "none"}`;
  if (!options.fresh && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  const at = Date.now();
  const value = readGuard(chain)
    .then((reads) => describeGuard(reads, chain, new Date(at)))
    .catch((error: unknown) => {
      console.error("[guardian] couldn't read the credit guard", error instanceof Error ? error.message : error);
      if (cache?.value === value) cache = null;
      return describeGuard(null, chain, new Date(at));
    });
  cache = { key, at, value };
  return value;
}
