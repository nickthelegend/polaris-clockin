/**
 * polaris-guardian's pure half (src/guardian/attestation.ts), held to the
 * contracts' own JavaScript: packages/contracts/lib/cre.js encodes the
 * GuardianReceiver suite's reports and computes `guardianReasons`, which that
 * suite fuzzes against GuardianReceiver.evaluate. Byte-identical reports and
 * identical verdicts here mean the receiver accepts what the workflow writes.
 * The on-chain round trip (the contract's own decoder and evaluate) is in the
 * local end-to-end run.
 */

import { describe, expect, test } from "bun:test";
import { guardianReceiverAbi } from "@polarispay/contracts/abi";
import { encodeFunctionData, type Hex } from "viem";
import {
  type Attestation,
  buildAttestation,
  decimal,
  decodeGuardianReport,
  encodeGuardianReport,
  type GuardState,
  guardianReasons,
  lendableUsd,
  PRICE_DECIMALS,
  REASON,
  reasonNames,
  REPORT_KIND_GUARDIAN,
  type Thresholds,
  transitionOf,
  writeDecision,
} from "../src/guardian/attestation.ts";
import { workflowNameBytes10 } from "../src/shared/evm.ts";
import { requireModule } from "./helpers/host.ts";

const creLib = requireModule("@polarispay/contracts/lib/cre") as {
  REPORT_KIND: { GUARDIAN: number };
  WORKFLOW_NAMES: { GUARDIAN: string };
  GUARDIAN_REASON: Record<string, number>;
  GUARDIAN_DEFAULTS: { minPrice: bigint; minFreeCash: bigint; maxBadDebtBps: number; maxPriceAge: number; maxAttestationAge: number };
  GUARDIAN_PRICE_DECIMALS: number;
  AUSD_USD_FEED_MONAD_MAINNET: { address: string; decimals: number; description: string; chainSelectorName: string };
  encodeGuardianReport(a: object): string;
  decodeGuardianReport(body: string): { kind: number; attestation: Record<string, unknown> };
  guardianReasons(a: object, t: object): number;
  workflowNameBytes10(name: string): string;
};

const D = creLib.GUARDIAN_DEFAULTS;
const DEFAULTS: Thresholds = { minPrice: D.minPrice, minFreeCash: D.minFreeCash, maxBadDebtBps: D.maxBadDebtBps, maxPriceAge: D.maxPriceAge };
const T0 = 1_790_000_000n;

/** A healthy attestation: the real AUSD price on 28 Sep 2026, a $100k pool. */
const healthy = (over: Partial<Attestation> = {}): Attestation => {
  const base = {
    priceRoundId: 18_446_744_073_709_559_171n, // phase 1, aggregator round 7555
    price: 99_982_564n,
    priceUpdatedAt: T0 - 1_500n,
    freeCash: 100_000_000_000n,
    totalOwed: 2_000_000_000n,
    badDebt: 0n,
    totalOriginated: 5_000_000_000n,
    observedAt: T0,
    ...over,
  };
  const reasons = guardianReasons(base, DEFAULTS);
  return { ...base, reasons, creditPaused: reasons !== 0, ...over };
};

describe("the report", () => {
  test("is byte-identical to packages/contracts/lib/cre.js, and each decodes the other's", () => {
    for (const a of [healthy(), healthy({ price: 90_000_000n }), buildAttestation({ round: { roundId: 0n, answer: -1n, updatedAt: 0n }, pool: { freeCash: 0n, totalOwed: 0n, badDebt: 0n, totalOriginated: 0n }, observedAt: 1n }, DEFAULTS)]) {
      const ours = encodeGuardianReport(a);
      expect(ours).toBe(creLib.encodeGuardianReport(a) as Hex);
      expect(decodeGuardianReport(ours)).toEqual({ kind: 3, attestation: a });
      const theirs = creLib.decodeGuardianReport(ours);
      expect(theirs.kind).toBe(3);
      expect({ ...theirs.attestation, reasons: Number(theirs.attestation.reasons) }).toEqual({ ...a });
    }
  });

  test("is a static tuple: the kind word and 10 words, 11 in all", () => {
    expect((encodeGuardianReport(healthy()).length - 2) / 2).toBe(11 * 32);
  });

  test("its body after the kind is what GuardianReceiver.evaluate takes as calldata", () => {
    const a = healthy({ price: 99_000_000n });
    const body = encodeGuardianReport(a);
    const call = encodeFunctionData({ abi: guardianReceiverAbi, functionName: "evaluate", args: [a] });
    // evaluate(Attestation) calldata = selector + the same 10 words the report carries after its kind.
    expect(call.slice(10)).toBe(body.slice(2 + 64));
  });

  test("names, kinds, bits and decimals agree with the contracts' own constants", () => {
    expect(REPORT_KIND_GUARDIAN).toBe(creLib.REPORT_KIND.GUARDIAN);
    expect(PRICE_DECIMALS).toBe(creLib.GUARDIAN_PRICE_DECIMALS);
    expect({ ...REASON } as Record<string, number>).toEqual({
      DEPEG: creLib.GUARDIAN_REASON.DEPEG!,
      LOW_CASH: creLib.GUARDIAN_REASON.LOW_CASH!,
      BAD_DEBT: creLib.GUARDIAN_REASON.BAD_DEBT!,
      STALE_PRICE: creLib.GUARDIAN_REASON.STALE_PRICE!,
      OWNER_PAUSE: creLib.GUARDIAN_REASON.OWNER_PAUSE!,
    });
    // The name the production forwarder carries: GuardianReceiver.setExpectedWorkflowName("polaris-guardian").
    expect(creLib.WORKFLOW_NAMES.GUARDIAN).toBe("polaris-guardian");
    expect(workflowNameBytes10("polaris-guardian")).toBe(creLib.workflowNameBytes10("polaris-guardian") as Hex);
    expect(workflowNameBytes10("polaris-guardian")).toBe("0x64383734313635346335");
  });
});

/** mulberry32: a seeded generator, so a failing case can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("the verdict", () => {
  test("each threshold, at its edge", () => {
    expect(healthy().reasons).toBe(0);
    // Depeg: strictly below minPrice.
    expect(guardianReasons(healthy({ price: DEFAULTS.minPrice }), DEFAULTS)).toBe(0);
    expect(guardianReasons(healthy({ price: DEFAULTS.minPrice - 1n }), DEFAULTS)).toBe(REASON.DEPEG);
    // Low cash: strictly below minFreeCash.
    expect(guardianReasons(healthy({ freeCash: DEFAULTS.minFreeCash }), DEFAULTS)).toBe(0);
    expect(guardianReasons(healthy({ freeCash: DEFAULTS.minFreeCash - 1n }), DEFAULTS)).toBe(REASON.LOW_CASH);
    // Bad debt: strictly above floor(originated x 5%).
    expect(guardianReasons(healthy({ badDebt: 250_000_000n }), DEFAULTS)).toBe(0);
    expect(guardianReasons(healthy({ badDebt: 250_000_001n }), DEFAULTS)).toBe(REASON.BAD_DEBT);
    expect(guardianReasons(healthy({ totalOriginated: 19n, badDebt: 0n }), DEFAULTS)).toBe(0);
    expect(guardianReasons(healthy({ totalOriginated: 19n, badDebt: 1n }), DEFAULTS)).toBe(REASON.BAD_DEBT); // floor(19 x 5%) = 0
    // Stale price: older than maxPriceAge, or never updated; a round newer than the pool block is fresh.
    expect(guardianReasons(healthy({ priceUpdatedAt: T0 - 7_200n }), DEFAULTS)).toBe(0);
    expect(guardianReasons(healthy({ priceUpdatedAt: T0 - 7_201n }), DEFAULTS)).toBe(REASON.STALE_PRICE);
    expect(guardianReasons(healthy({ priceUpdatedAt: 0n }), DEFAULTS)).toBe(REASON.STALE_PRICE);
    expect(guardianReasons(healthy({ priceUpdatedAt: T0 + 30n }), DEFAULTS)).toBe(0);
    // Everything at once.
    expect(
      guardianReasons(healthy({ price: 1n, freeCash: 0n, badDebt: 10n, totalOriginated: 10n, priceUpdatedAt: 0n }), DEFAULTS),
    ).toBe(REASON.DEPEG | REASON.LOW_CASH | REASON.BAD_DEBT | REASON.STALE_PRICE);
  });

  test("the demo's raised threshold ($1.001) turns the real AUSD price into a depeg", () => {
    const raised = { ...DEFAULTS, minPrice: 100_100_000n };
    const a = buildAttestation({ round: { roundId: 7n, answer: 99_982_564n, updatedAt: T0 - 60n }, pool: healthy(), observedAt: T0 }, raised);
    expect(a).toMatchObject({ creditPaused: true, reasons: REASON.DEPEG });
    expect(reasonNames(a.reasons)).toEqual(["depeg"]);
  });

  test("is packages/contracts/lib/cre.js guardianReasons on 5,000 random attestations near every edge", () => {
    const next = rng(0x9a4d);
    const near = (edge: bigint, spread: bigint) => edge - spread + BigInt(Math.floor(next() * Number(spread * 2n + 1n)));
    const nearNonNegative = (edge: bigint, spread: bigint) => {
      const v = near(edge, spread);
      return v < 0n ? 0n : v;
    };
    for (let i = 0; i < 5_000; i++) {
      const t: Thresholds = {
        minPrice: BigInt(1 + Math.floor(next() * 200_000_000)),
        minFreeCash: BigInt(Math.floor(next() * 5_000_000_000)),
        maxBadDebtBps: Math.floor(next() * 10_001),
        maxPriceAge: 1 + Math.floor(next() * 86_400),
      };
      const observedAt = T0 + BigInt(Math.floor(next() * 1_000));
      const totalOriginated = BigInt(Math.floor(next() * 1e12));
      const a = {
        price: near(t.minPrice, 3n),
        freeCash: nearNonNegative(t.minFreeCash, 3n),
        badDebt: nearNonNegative((totalOriginated * BigInt(t.maxBadDebtBps)) / 10_000n, 2n),
        totalOriginated,
        priceUpdatedAt: next() < 0.02 ? 0n : observedAt - near(BigInt(t.maxPriceAge), 2n),
        observedAt,
      };
      expect(guardianReasons(a, t)).toBe(creLib.guardianReasons(a, t));
    }
  });

  test("reason words, lowest bit first", () => {
    expect(reasonNames(0)).toEqual([]);
    expect(reasonNames(REASON.DEPEG | REASON.STALE_PRICE)).toEqual(["depeg", "stale_price"]);
    expect(reasonNames(REASON.OWNER_PAUSE)).toEqual(["owner_pause"]);
  });

  test("the feed-shaped answer: free cash in dollars at the attested price, 0 while paused", () => {
    expect(lendableUsd(healthy(), 1_000_000n)).toBe((100_000_000_000n * 99_982_564n) / 1_000_000n);
    expect(decimal(lendableUsd(healthy(), 1_000_000n), 8)).toBe("99982.564");
    expect(lendableUsd(healthy({ price: 1n, creditPaused: true }), 1_000_000n)).toBe(0n);
  });

  test("decimal() renders fixed point without floats", () => {
    expect(decimal(99_982_564n, 8)).toBe("0.99982564");
    expect(decimal(100_000_000n, 8)).toBe("1");
    expect(decimal(-1n, 8)).toBe("-0.00000001");
  });
});

describe("when a run writes", () => {
  const policy = { heartbeatSeconds: 900, deviationBps: 1_000 };
  const state = (over: Partial<GuardState> = {}): GuardState => ({
    paused: false,
    reasons: 0,
    attestedPaused: false,
    attestedReasons: 0,
    observedAt: T0 - 60n,
    stale: false,
    overrideMode: 0,
    maxAttestationAge: 3_600,
    round: 4n,
    ...over,
  });
  const previous = healthy({ observedAt: T0 - 60n });

  test("the first attestation is always written", () => {
    expect(writeDecision(healthy(), state({ observedAt: 0n, round: 0n }), null, policy)).toEqual({ write: true, why: "first" });
  });

  test("a changed verdict is written at once, both ways", () => {
    const paused = healthy({ price: 90_000_000n });
    expect(writeDecision(paused, state(), previous, policy)).toEqual({ write: true, why: "verdict" });
    expect(transitionOf(paused, state())).toBe("paused");
    const resumed = healthy();
    const wasPaused = state({ attestedPaused: true, attestedReasons: REASON.DEPEG, paused: true, reasons: REASON.DEPEG });
    expect(writeDecision(resumed, wasPaused, { ...previous, price: 90_000_000n, reasons: REASON.DEPEG }, policy)).toEqual({ write: true, why: "verdict" });
    expect(transitionOf(resumed, wasPaused)).toBe("resumed");
    // Another reason on top of a pause is a new verdict too.
    const worse = healthy({ price: 90_000_000n, freeCash: 0n });
    expect(writeDecision(worse, wasPaused, previous, policy).why).toBe("verdict");
    expect(transitionOf(worse, wasPaused)).toBe("reasons-changed");
  });

  test("an unchanged verdict waits for the heartbeat, unless free cash x price moved by the deviation", () => {
    expect(writeDecision(healthy(), state(), previous, policy)).toEqual({ write: false, why: "unchanged" });
    expect(writeDecision(healthy({ observedAt: T0 - 60n + 900n }), state(), previous, policy)).toEqual({ write: true, why: "heartbeat" });
    expect(writeDecision(healthy({ freeCash: 89_000_000_000n }), state(), previous, policy)).toEqual({ write: true, why: "deviation" });
    expect(writeDecision(healthy({ freeCash: 91_000_000_000n }), state(), previous, policy).write).toBe(false);
    expect(writeDecision(healthy({ freeCash: 89_000_000_000n }), state(), previous, { ...policy, deviationBps: 0 }).write).toBe(false);
    expect(writeDecision(healthy(), state(), previous, { heartbeatSeconds: 0, deviationBps: 0 })).toEqual({ write: true, why: "heartbeat" });
  });

  test("a stale attestation is replaced, and nothing older than the latest is ever sent", () => {
    expect(writeDecision(healthy(), state({ stale: true }), previous, policy)).toEqual({ write: true, why: "stale" });
    expect(writeDecision(healthy({ observedAt: T0 - 60n }), state(), previous, policy)).toEqual({ write: false, why: "not-newer" });
    expect(writeDecision(healthy({ observedAt: T0 - 61n, price: 1n }), state(), previous, policy)).toEqual({ write: false, why: "not-newer" });
  });
});
