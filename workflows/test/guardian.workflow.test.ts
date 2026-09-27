/**
 * The polaris-guardian handler under the CRE SDK's test runtime: two EVM
 * capabilities (Monad testnet for the pool and the receiver, Monad mainnet for
 * Chainlink's AUSD/USD feed), one report out, the receiver's answer read back.
 */

import { describe, expect } from "bun:test";
import { blockNumber, cre, type CronPayload, LAST_FINALIZED_BLOCK_NUMBER, protoBigIntToBigint } from "@chainlink/cre-sdk";
import { addContractMock, EvmMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { aggregatorV3InterfaceAbi, guardianReceiverAbi } from "@polarispay/contracts/abi";
import { type Address, encodeErrorResult, type Hex, parseAbi } from "viem";
import { type Attestation, decodeGuardianReport, guardianReasons, REASON, type Thresholds } from "../src/guardian/attestation.ts";
import { configSchema, type GuardianConfig, initWorkflow, onCron } from "../src/guardian/workflow.ts";
import { b64, eventLog, fakeTxHash, hexOf, receiptJson, type TestLog } from "./helpers/evm.ts";

const RECEIVER = "0x00000000000000000000000000000000006a4d00" as Address;
const FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as Address;
const FEED = "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13" as Address;
const TESTNET = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-testnet"];
const MAINNET = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-mainnet"];
const BLOCK = 66_257_212n;
const NOW = 1_790_028_277n;

const baseConfig = (over: Partial<GuardianConfig> = {}): GuardianConfig =>
  configSchema.parse({
    schedule: "0 * * * * *",
    chainSelectorName: "monad-testnet",
    receiver: RECEIVER,
    forwarder: FORWARDER,
    priceFeed: { chainSelectorName: "monad-mainnet", address: FEED, decimals: 8, description: "AUSD / USD", kind: "chainlink" },
    write: { heartbeatSeconds: 900, deviationBps: 1000 },
    gas: { overhead: "30000", headroomBps: 1500, min: "150000", max: "1000000" },
    ...over,
  });

const DEFAULTS: Thresholds = { minPrice: 99_500_000n, minFreeCash: 1_000_000_000n, maxBadDebtBps: 500, maxPriceAge: 7_200 };
const POOL = { freeCash: 100_000_000_000n, totalOwed: 2_000_000_000n, badDebt: 0n, totalOriginated: 5_000_000_000n };
/** Chainlink AUSD/USD's latestRoundData on Monad mainnet, 28 Sep 2026. */
const ROUND = { roundId: 18_446_744_073_709_559_171n, answer: 99_982_564n, updatedAt: 1_790_026_776n };

/** Which block a read asked for: "finalized", "latest", or its number. */
const blockOf = (b: { absVal: Uint8Array; sign: bigint } | undefined): string =>
  !b ? "latest" : b.sign < 0n ? (b.absVal[0] === 3 ? "finalized" : "latest") : protoBigIntToBigint(b).toString();

const EVENTS = parseAbi([
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

interface Chain {
  pool?: typeof POOL;
  thresholds?: Thresholds;
  round?: typeof ROUND;
  decimals?: number;
  description?: string;
  /** The receiver's latest attestation, or none. */
  latest?: Attestation | null;
  stale?: boolean;
  overrideMode?: number;
  maxAttestationAge?: number;
  transmitter?: Address;
  /** What the receiver does with a report: accept (default), refuse with an error, or revert (ReportProcessed false). */
  answer?: "accept" | { refuse: Hex } | "revert";
}

function fakeChains(chain: Chain = {}) {
  const testnet = EvmMock.testInstance(TESTNET);
  const mainnet = EvmMock.testInstance(MAINNET);
  const seen = {
    testnetBlocks: [] as string[],
    mainnetBlocks: [] as string[],
    headers: 0,
    feedReads: [] as string[],
    reports: [] as Attestation[],
    gasLimits: [] as bigint[],
    estimates: [] as Array<{ from: string; to: string }>,
  };
  const t = chain.thresholds ?? DEFAULTS;
  const latest = chain.latest ?? null;

  testnet.headerByNumber = (req) => {
    seen.headers++;
    expect(req.blockNumber).toMatchObject({ sign: -1n }); // "finalized", as LAST_FINALIZED_BLOCK_NUMBER encodes it
    return { header: { timestamp: NOW.toString(), blockNumber: blockNumber(BLOCK), hash: b64(fakeTxHash("block")), parentHash: b64(fakeTxHash("parent")) } };
  };
  const guardian = addContractMock(testnet, { address: RECEIVER, abi: guardianReceiverAbi });
  guardian.currentInputs = () => [chain.pool ?? POOL, t];
  guardian.creditStatus = () => ({
    paused: latest ? latest.creditPaused : false,
    reasons: latest ? latest.reasons : 0,
    attestedPaused: latest?.creditPaused ?? false,
    attestedReasons: latest?.reasons ?? 0,
    observedAt: latest?.observedAt ?? 0n,
    stale: chain.stale ?? latest === null,
    overrideMode: chain.overrideMode ?? 0,
    maxAttestationAge: chain.maxAttestationAge ?? 3600,
    round: latest ? 4n : 0n,
  });
  guardian.latestAttestation = () => latest;
  if (chain.transmitter) guardian.simulationTransmitter = () => chain.transmitter;
  const routeTestnet = testnet.callContract!;
  testnet.callContract = (req) => {
    seen.testnetBlocks.push(blockOf(req.blockNumber));
    return routeTestnet(req);
  };

  const feed = addContractMock(mainnet, { address: FEED, abi: aggregatorV3InterfaceAbi });
  feed.decimals = () => {
    seen.feedReads.push("decimals");
    return chain.decimals ?? 8;
  };
  feed.description = () => {
    seen.feedReads.push("description");
    return chain.description ?? "AUSD / USD";
  };
  feed.latestRoundData = () => {
    seen.feedReads.push("latestRoundData");
    const r = chain.round ?? ROUND;
    return [r.roundId, r.answer, r.updatedAt, r.updatedAt, r.roundId];
  };
  const routeMainnet = mainnet.callContract!;
  mainnet.callContract = (req) => {
    seen.mainnetBlocks.push(blockOf(req.blockNumber));
    return routeMainnet(req);
  };

  testnet.estimateGas = (req) => {
    seen.estimates.push({ from: hexOf(req.msg!.from).toLowerCase(), to: hexOf(req.msg!.to).toLowerCase() });
    return { gas: "121000" };
  };
  let lastLogs: TestLog[] = [];
  testnet.writeReport = (req) => {
    const raw = hexOf(req.report!.rawReport);
    const { kind, attestation } = decodeGuardianReport(`0x${raw.slice(2 + 109 * 2)}` as Hex);
    expect(kind).toBe(3);
    seen.reports.push(attestation);
    seen.gasLimits.push(req.gasConfig!.gasLimit);
    const logs: TestLog[] = [];
    const answer = chain.answer ?? "accept";
    if (answer === "accept") {
      logs.push(eventLog(guardianReceiverAbi, "CreditGuardUpdated", RECEIVER, { round: 5n, creditPaused: attestation.creditPaused, reasons: attestation.reasons, attestation }));
    } else if (answer !== "revert") {
      logs.push(eventLog(guardianReceiverAbi, "AttestationRefused", RECEIVER, { observedAt: attestation.observedAt, reason: answer.refuse }));
    }
    logs.push(eventLog(EVENTS, "ReportProcessed", FORWARDER, { receiver: RECEIVER, workflowExecutionId: fakeTxHash("exec"), reportId: "0x0001", result: answer !== "revert" }));
    lastLogs = logs;
    return { txStatus: "TX_STATUS_SUCCESS", txHash: b64(fakeTxHash(`tx${seen.reports.length}`)) };
  };
  testnet.getTransactionReceipt = () => receiptJson(lastLogs);
  return seen;
}

const cron = { scheduledExecutionTime: { seconds: NOW, nanos: 0 } } as unknown as CronPayload;
const run = (config: GuardianConfig = baseConfig()) => {
  const runtime = newTestRuntime(null, { timeProvider: () => Number(NOW) * 1000 }, config);
  const out = JSON.parse(onCron(runtime, cron));
  return { out, logs: runtime.getLogs() };
};

/** An attestation the receiver already holds, `ago` seconds before this run's block. */
const held = (ago: bigint, over: Partial<Attestation> = {}): Attestation => {
  const a = { priceRoundId: ROUND.roundId - 1n, price: ROUND.answer, priceUpdatedAt: ROUND.updatedAt - 3600n, ...POOL, observedAt: NOW - ago, ...over };
  const reasons = over.reasons ?? guardianReasons(a, DEFAULTS);
  return { ...a, reasons, creditPaused: reasons !== 0 };
};

describe("polaris-guardian", () => {
  test("first run: the pool at one finalized testnet block, Chainlink's price on mainnet, one healthy attestation written", () => {
    const seen = fakeChains();
    const { out, logs } = run();
    expect(out).toMatchObject({ status: "written", why: "first", transition: "first", round: "5", refusal: null });
    expect(out.verdict).toEqual({ creditPaused: false, reasons: 0, reasonNames: [] });
    expect(seen.reports).toEqual([
      {
        priceRoundId: ROUND.roundId,
        price: ROUND.answer,
        priceUpdatedAt: ROUND.updatedAt,
        ...POOL,
        observedAt: NOW,
        creditPaused: false,
        reasons: 0,
      },
    ]);
    // One header read; every testnet read at that block's number, not at "finalized" again.
    expect(seen.headers).toBe(1);
    // currentInputs, creditStatus, then the transmitter check (the write path reads at the finalized head).
    expect(seen.testnetBlocks).toEqual([BLOCK.toString(), BLOCK.toString(), "finalized"]);
    // The feed: identity checked, then the round, at mainnet's last finalized block.
    expect(seen.feedReads).toEqual(["decimals", "description", "latestRoundData"]);
    expect(seen.mainnetBlocks).toEqual(["finalized", "finalized", "finalized"]);
    expect(out.price).toMatchObject({ kind: "chainlink", chain: "monad-mainnet", answer: "0.99982564", ageSeconds: Number(NOW - ROUND.updatedAt) });
    expect(out.pool).toMatchObject({ block: BLOCK.toString(), observedAt: Number(NOW), freeCash: "100000000000" });
    expect(logs.join("\n")).toContain("Chainlink AUSD / USD on monad-mainnet: 0.99982564");
    // The receiver as deployed guards simulation by origin; this one has no transmitter: onReport from the forwarder, + overhead + 15%.
    expect(seen.estimates).toEqual([{ from: FORWARDER.toLowerCase(), to: RECEIVER.toLowerCase() }]);
    expect(seen.gasLimits[0]).toBe(((121_000n + 30_000n) * 11_500n) / 10_000n);
  });

  test("the owner raises the depeg threshold to $1.001 on chain: the real price pauses Pay in 4 at once", () => {
    const seen = fakeChains({ thresholds: { ...DEFAULTS, minPrice: 100_100_000n }, latest: held(60n) });
    const { out } = run();
    expect(out).toMatchObject({ status: "written", why: "verdict", transition: "paused", thresholds: { minPrice: "1.001" } });
    expect(out.verdict).toEqual({ creditPaused: true, reasons: REASON.DEPEG, reasonNames: ["depeg"] });
    expect(seen.reports[0]).toMatchObject({ creditPaused: true, reasons: REASON.DEPEG, price: ROUND.answer });
  });

  test("a healthy report after a pause resumes credit", () => {
    const seen = fakeChains({ latest: held(60n, { reasons: REASON.DEPEG }) });
    const { out } = run();
    expect(out).toMatchObject({ status: "written", why: "verdict", transition: "resumed", before: { paused: true, attestedReasons: REASON.DEPEG } });
    expect(seen.reports[0]).toMatchObject({ creditPaused: false, reasons: 0 });
  });

  test("every reason the pool can give: low cash, bad debt, a stale price", () => {
    fakeChains({ pool: { ...POOL, freeCash: 999_999_999n, badDebt: 300_000_000n }, round: { ...ROUND, updatedAt: NOW - 7_201n } });
    const { out } = run();
    expect(out.verdict).toEqual({
      creditPaused: true,
      reasons: REASON.LOW_CASH | REASON.BAD_DEBT | REASON.STALE_PRICE,
      reasonNames: ["low_cash", "bad_debt", "stale_price"],
    });
  });

  test("an unchanged verdict inside the heartbeat writes nothing; past it, or on a large move, it is re-attested", () => {
    const quiet = fakeChains({ latest: held(60n) });
    const { out, logs } = run();
    expect(out).toMatchObject({ status: "unchanged", why: "unchanged", txHash: null });
    expect(quiet.reports).toHaveLength(0);
    expect(quiet.estimates).toHaveLength(0);
    expect(logs.join("\n")).toContain("the latest attestation is 60s old");

    expect(fakeChains({ latest: held(900n) }) && run().out).toMatchObject({ status: "written", why: "heartbeat" });
    expect(fakeChains({ latest: held(60n), pool: { ...POOL, freeCash: 80_000_000_000n } }) && run().out).toMatchObject({ status: "written", why: "deviation" });
  });

  test("a feed that is not the configured one fails the run before anything is written", () => {
    const wrongName = fakeChains({ description: "MON / USD" });
    expect(() => run()).toThrow(/is "MON \/ USD", not "AUSD \/ USD"/);
    expect(wrongName.reports).toHaveLength(0);
    // The SVR variant of the same pair has 18 decimals: refused, not rescaled.
    fakeChains({ decimals: 18 });
    expect(() => run()).toThrow(/18 decimals, not 8/);
  });

  test("a refusal is decoded and reported, not thrown: the next run reads the new thresholds", () => {
    const reason = encodeErrorResult({ abi: guardianReceiverAbi, errorName: "VerdictMismatch", args: [false, 0, REASON.DEPEG] });
    fakeChains({ answer: { refuse: reason } });
    const { out } = run();
    expect(out).toMatchObject({ status: "refused", refusal: "VerdictMismatch(false, 0, 1)", round: null });
    expect(out.note).toContain("GuardianReceiver refused the attestation: VerdictMismatch(false, 0, 1)");
  });

  test("a delivery the receiver reverted fails the run, though simulation calls the write a success", () => {
    fakeChains({ answer: "revert" });
    expect(() => run()).toThrow(/GuardianReceiver reverted the report/);
  });

  test("behind a simulation transmitter the whole delivery is estimated from it", () => {
    const transmitter = "0x00000000000000000000000000000000000000a1" as Address;
    const seen = fakeChains({ transmitter });
    run();
    expect(seen.estimates).toEqual([{ from: transmitter, to: FORWARDER.toLowerCase() }]);
    expect(seen.gasLimits[0]).toBe(150_000n); // (121,000 + 15%) under the floor
  });

  test("says so when the owner's override decides, or when the heartbeat outlives the attestation", () => {
    fakeChains({ latest: held(60n), overrideMode: 2 });
    expect(run().out.note).toContain("the owner's override (force_pause) decides openPlan");
    fakeChains({ latest: held(60n), maxAttestationAge: 600 });
    expect(run().out.note).toContain("credit fails open, before it is re-attested");
  });

  test("stays far inside CRE's 15-read quota", () => {
    const seen = fakeChains({ latest: held(1_000n), transmitter: "0x00000000000000000000000000000000000000a1" });
    run();
    // header + currentInputs + creditStatus + latestAttestation + transmitter, 3 feed reads, the estimate, the receipt.
    const reads = seen.headers + seen.testnetBlocks.length + seen.mainnetBlocks.length + seen.estimates.length + 1;
    expect(reads).toBe(10);
  });

  test("registers one cron trigger, on the configured schedule", () => {
    const handlers = initWorkflow(baseConfig({ schedule: "0 */10 * * * *" }));
    expect(handlers).toHaveLength(1);
    expect((handlers[0]!.trigger as unknown as { config: { schedule: string } }).config.schedule).toBe("0 */10 * * * *");
    expect(LAST_FINALIZED_BLOCK_NUMBER.sign).toBe("-1");
  });
});
