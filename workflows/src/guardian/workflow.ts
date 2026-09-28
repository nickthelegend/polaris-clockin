/**
 * `polaris-guardian`: Pay in 4's risk guard, on a cron.
 *
 * Each run, in one DON:
 *
 *   1. The pool. One finalized block of the pool's chain (Monad testnet): its
 *      header (number and timestamp), then, at that number,
 *      `GuardianReceiver.currentInputs()` (PolarisLoanEngine's free cash,
 *      what buyers owe, bad debt, lifetime originations; the thresholds the
 *      owner set on chain; the bad debt the owner acknowledged),
 *      `creditStatus()` and `latestAttestation()`.
 *   2. The peg. Chainlink's AUSD/USD Data Feed on Monad MAINNET (chain 143;
 *      Monad testnet has no AUSD feed), read with a second EVM client:
 *      `decimals()` and `description()` checked against the config, then
 *      `latestRoundData()` at mainnet's last finalized block.
 *   3. The verdict (./attestation.ts, the same formula as
 *      GuardianReceiver.evaluate): depeg (below $0.995 or above $1.005 by
 *      default), low free cash, bad debt, stale price.
 *   4. The write, when it says something new (a changed verdict, the
 *      heartbeat, a large move: ./attestation.ts `writeDecision`): one signed
 *      report through the forwarder, gas sized from its own estimate, and the
 *      receipt read back for `CreditGuardUpdated` or `AttestationRefused`.
 *
 * What it moves: PolarisCheckout.openPlan asks GuardianReceiver before each
 * new Pay in 4 plan and refuses while it says "paused"
 * (`CreditPausedByGuardian(reasons)`). The receiver takes only the price from
 * this report: depeg and stale price come from the latest attestation (and
 * fail open once it is older than `maxAttestationAge`), while low cash and
 * bad debt it reads from the pool itself on every call, and it refuses a
 * report whose pool verdict is not the live pool's. So this workflow is what
 * brings the mainnet price to the testnet pool; it cannot pause or resume
 * credit on the pool's figures by its own say. Pay now, Send and Subscribe
 * never ask.
 *
 * The thresholds are read from the chain every run, so the owner can change
 * them (`setThresholds`) without touching the workflow: the demo raises the
 * depeg threshold above the real AUSD price to show a pause.
 */

import { type CronPayload, cre, type Runtime } from "@chainlink/cre-sdk";
import { aggregatorV3InterfaceAbi, guardianReceiverAbi } from "@polarispay/contracts/abi";
import { type Address, decodeErrorResult, type Hex } from "viem";
import { z } from "zod";
import { address, chainSelectorName, gasSchema } from "../shared/config.ts";
import {
  atBlock,
  decodeLogsFrom,
  deliveredTo,
  type EVMClient,
  evmClientFor,
  finalizedHeader,
  readContract,
  readReceipt,
  signReport,
  writeSized,
} from "../shared/evm.ts";
import {
  type Attestation,
  buildAttestation,
  decimal,
  encodeGuardianReport,
  type GuardState,
  OVERRIDE,
  OVERRIDE_NAME,
  type PoolState,
  PRICE_DECIMALS,
  type PriceRound,
  reasonNames,
  type Thresholds,
  transitionOf,
  type WriteWhy,
  writeDecision,
} from "./attestation.ts";

export const configSchema = z.object({
  /** Six-field cron (seconds first), UTC. Staging every minute, production every 10 minutes. */
  schedule: z.string().min(1),
  /** The pool's chain, where GuardianReceiver is: monad-testnet. */
  chainSelectorName,
  receiver: address("GuardianReceiver"),
  /** The forwarder the receiver trusts; the gas estimate calls `onReport` as it. */
  forwarder: address("forwarder"),
  /** The AUSD/USD price the verdict judges the peg by. */
  priceFeed: z.object({
    /** monad-mainnet for Chainlink's feed; the local stand-in's own chain for its mock. */
    chainSelectorName,
    address: address("the AUSD/USD feed"),
    /** GuardianReceiver takes PRICE_DECIMALS; a feed with other decimals is refused, not rescaled. */
    decimals: z.literal(PRICE_DECIMALS),
    /** What the feed's `description()` must say, so a wrong address fails loudly. */
    description: z.string().min(1),
    /** "chainlink": Chainlink's Data Feed. "mock": the local chain's labelled stand-in. */
    kind: z.enum(["chainlink", "mock"]),
  }),
  /** When an unchanged verdict is written again (./attestation.ts `writeDecision`). */
  write: z.object({
    /** Re-attest an unchanged verdict once the last is this old; keep it below maxAttestationAge. 0 writes every run. */
    heartbeatSeconds: z.number().int().min(0).max(604_800),
    /** Re-attest when free cash x price moved by this much, in basis points; 0 turns it off. */
    deviationBps: z.number().int().min(0).max(10_000),
  }),
  gas: gasSchema,
});
export type GuardianConfig = z.infer<typeof configSchema>;

/** CRE's EVM read quota per execution; a run uses at most 10. */
export const EVM_READ_LIMIT = 15;

export interface GuardianResult {
  /** written: accepted on chain; refused: the receiver refused it (see `refusal`); unchanged: nothing new, no write. */
  status: "written" | "refused" | "unchanged" | "dry-run";
  why: WriteWhy;
  /** How credit moves if this attestation stands: first, paused, resumed, reasons-changed, unchanged. */
  transition: ReturnType<typeof transitionOf>;
  verdict: { creditPaused: boolean; reasons: number; reasonNames: string[] };
  price: {
    kind: "chainlink" | "mock";
    chain: string;
    feed: Address;
    description: string;
    roundId: string;
    answer: string;
    updatedAt: number;
    /** Seconds between the round's update and the pool block; 0 if the round is newer. */
    ageSeconds: number;
  };
  pool: {
    chain: string;
    block: string;
    observedAt: number;
    freeCash: string;
    totalOwed: string;
    badDebt: string;
    totalOriginated: string;
    /** Bad debt the owner acknowledged: only bad debt beyond it counts. */
    badDebtAcknowledged: string;
  };
  thresholds: { minPrice: string; maxPrice: string; minFreeCash: string; maxBadDebtBps: number; minOriginated: string; maxPriceAge: number };
  /** The receiver before this run: what openPlan applied, and why (the live pool, the latest price), the latest attestation, the owner's override. */
  before: {
    paused: boolean;
    reasons: number;
    poolReasons: number;
    priceReasons: number;
    attestedReasons: number;
    observedAt: number;
    stale: boolean;
    override: string;
    overrideUntil: number;
    maxAttestationAge: number;
  };
  /** The feed round this attestation became, when accepted. */
  round: string | null;
  /** The receiver's refusal, decoded, when refused. */
  refusal: string | null;
  txHash: string | null;
  gasLimit: string | null;
  note: string | null;
}

interface CreditStatusRaw {
  paused: boolean;
  reasons: number;
  attestedPaused: boolean;
  attestedReasons: number;
  observedAt: bigint;
  stale: boolean;
  overrideMode: number;
  maxAttestationAge: number;
  round: bigint;
  overrideUntil: bigint;
  poolReasons: number;
  priceReasons: number;
  badDebtAcknowledged: bigint;
}

/** GuardianReceiver.thresholds() as viem decodes it (uint16 and uint32 as numbers). */
interface ThresholdsRaw {
  minPrice: bigint;
  maxPrice: bigint;
  minFreeCash: bigint;
  maxBadDebtBps: number;
  minOriginated: bigint;
  maxPriceAge: number;
}

/** The feed read, with its identity checked against the config first. */
function readPrice(runtime: Runtime<GuardianConfig>, feedEvm: EVMClient): PriceRound {
  const f = runtime.config.priceFeed;
  const decimals = Number(readContract(runtime, feedEvm, { address: f.address, abi: aggregatorV3InterfaceAbi, functionName: "decimals" }));
  if (decimals !== f.decimals) {
    throw new Error(`the feed at ${f.address} on ${f.chainSelectorName} has ${decimals} decimals, not ${f.decimals}: refusing to attest a mis-scaled price`);
  }
  const description = readContract(runtime, feedEvm, { address: f.address, abi: aggregatorV3InterfaceAbi, functionName: "description" }) as string;
  if (description !== f.description) {
    throw new Error(`the feed at ${f.address} on ${f.chainSelectorName} is "${description}", not "${f.description}"`);
  }
  const [roundId, answer, , updatedAt] = readContract(runtime, feedEvm, {
    address: f.address,
    abi: aggregatorV3InterfaceAbi,
    functionName: "latestRoundData",
  }) as readonly [bigint, bigint, bigint, bigint, bigint];
  return { roundId, answer, updatedAt };
}

/** A refusal's `bytes reason`, as `Name(arg, …)`. */
function refusalText(reason: Hex): string {
  try {
    const e = decodeErrorResult({ abi: guardianReceiverAbi, data: reason });
    return `${e.errorName}(${(e.args ?? []).map(String).join(", ")})`;
  } catch {
    return `unknown(${reason.slice(0, 10)})`;
  }
}

export function onCron(runtime: Runtime<GuardianConfig>, _payload: CronPayload): string {
  const cfg = runtime.config;
  const evm = evmClientFor(cfg.chainSelectorName);
  const feedEvm = cfg.priceFeed.chainSelectorName === cfg.chainSelectorName ? evm : evmClientFor(cfg.priceFeed.chainSelectorName);
  const notes: string[] = [];
  const note = (s: string) => {
    notes.push(s);
    runtime.log(s);
  };

  // 1. The pool, every read at one finalized block of its chain.
  const head = finalizedHeader(runtime, evm);
  const block = atBlock(head.number);
  const [state, limits, acknowledged] = readContract(runtime, evm, {
    address: cfg.receiver,
    abi: guardianReceiverAbi,
    functionName: "currentInputs",
    block,
  }) as readonly [PoolState, ThresholdsRaw, bigint];
  const raw = readContract(runtime, evm, { address: cfg.receiver, abi: guardianReceiverAbi, functionName: "creditStatus", block }) as CreditStatusRaw;
  const status: GuardState = {
    ...raw,
    overrideMode: Number(raw.overrideMode),
    maxAttestationAge: Number(raw.maxAttestationAge),
    poolReasons: Number(raw.poolReasons),
    priceReasons: Number(raw.priceReasons),
  };
  const latest =
    status.observedAt === 0n
      ? null
      : (readContract(runtime, evm, { address: cfg.receiver, abi: guardianReceiverAbi, functionName: "latestAttestation", block }) as Attestation);

  // 2. The peg, from the feed's own chain.
  const round = readPrice(runtime, feedEvm);

  // 3. The verdict, by the thresholds on chain.
  const thresholds: Thresholds = {
    minPrice: limits.minPrice,
    maxPrice: limits.maxPrice,
    minFreeCash: limits.minFreeCash,
    maxBadDebtBps: Number(limits.maxBadDebtBps),
    minOriginated: limits.minOriginated,
    maxPriceAge: Number(limits.maxPriceAge),
  };
  const attestation = buildAttestation({ round, pool: state, observedAt: head.timestamp }, thresholds, acknowledged);
  const decision = writeDecision(attestation, status, latest, cfg.write);
  const transition = transitionOf(attestation, status);

  const age = head.timestamp > round.updatedAt ? Number(head.timestamp - round.updatedAt) : 0;
  const source = cfg.priceFeed.kind === "chainlink" ? `Chainlink ${cfg.priceFeed.description}` : `${cfg.priceFeed.description}`;
  runtime.log(
    `${source} on ${cfg.priceFeed.chainSelectorName}: ${decimal(round.answer, PRICE_DECIMALS)} (round ${round.roundId}, updated ${age}s before the pool block)`,
  );
  runtime.log(
    `pool at ${cfg.chainSelectorName} block ${head.number}: free cash ${state.freeCash}, owed ${state.totalOwed}, bad debt ${state.badDebt} of ${state.totalOriginated} originated (base units)` +
      (acknowledged > 0n ? `, ${acknowledged} of it acknowledged` : ""),
  );
  const words = reasonNames(attestation.reasons);
  runtime.log(`verdict: ${attestation.creditPaused ? `pause Pay in 4 (${words.join(", ")})` : "healthy"}; ${transition}; ${decision.why}`);
  if (cfg.write.heartbeatSeconds >= status.maxAttestationAge) {
    note(
      `heartbeatSeconds (${cfg.write.heartbeatSeconds}) is not below the receiver's maxAttestationAge (${status.maxAttestationAge}): an unchanged verdict goes stale, and credit fails open, before it is re-attested`,
    );
  }
  if (status.overrideMode !== OVERRIDE.NONE) {
    const until = status.overrideMode === OVERRIDE.FORCE_RESUME && status.overrideUntil ? ` until ${status.overrideUntil}` : "";
    note(`the owner's override (${OVERRIDE_NAME[status.overrideMode]}${until}) decides openPlan, whatever this attestation says`);
  }

  const result: GuardianResult = {
    status: "unchanged",
    why: decision.why,
    transition,
    verdict: { creditPaused: attestation.creditPaused, reasons: attestation.reasons, reasonNames: words },
    price: {
      kind: cfg.priceFeed.kind,
      chain: cfg.priceFeed.chainSelectorName,
      feed: cfg.priceFeed.address,
      description: cfg.priceFeed.description,
      roundId: round.roundId.toString(),
      answer: decimal(round.answer, PRICE_DECIMALS),
      updatedAt: Number(round.updatedAt),
      ageSeconds: age,
    },
    pool: {
      chain: cfg.chainSelectorName,
      block: head.number.toString(),
      observedAt: Number(head.timestamp),
      freeCash: state.freeCash.toString(),
      totalOwed: state.totalOwed.toString(),
      badDebt: state.badDebt.toString(),
      totalOriginated: state.totalOriginated.toString(),
      badDebtAcknowledged: acknowledged.toString(),
    },
    thresholds: {
      minPrice: decimal(thresholds.minPrice, PRICE_DECIMALS),
      maxPrice: decimal(thresholds.maxPrice, PRICE_DECIMALS),
      minFreeCash: thresholds.minFreeCash.toString(),
      maxBadDebtBps: thresholds.maxBadDebtBps,
      minOriginated: thresholds.minOriginated.toString(),
      maxPriceAge: thresholds.maxPriceAge,
    },
    before: {
      paused: status.paused,
      reasons: status.reasons,
      poolReasons: status.poolReasons ?? 0,
      priceReasons: status.priceReasons ?? 0,
      attestedReasons: status.attestedReasons,
      observedAt: Number(status.observedAt),
      stale: status.stale,
      override: OVERRIDE_NAME[status.overrideMode] ?? String(status.overrideMode),
      overrideUntil: Number(status.overrideUntil ?? 0n),
      maxAttestationAge: status.maxAttestationAge,
    },
    round: null,
    refusal: null,
    txHash: null,
    gasLimit: null,
    note: null,
  };
  const finish = (r: GuardianResult) => JSON.stringify({ ...r, note: notes.length > 0 ? notes.join("; ") : null });

  if (!decision.write) {
    runtime.log(
      decision.why === "not-newer"
        ? `nothing written: block ${head.number} is not newer than the latest attestation`
        : `nothing written: the verdict is unchanged and the latest attestation is ${Number(head.timestamp - status.observedAt)}s old`,
    );
    return finish(result);
  }

  // 4. One signed report; the receiver re-evaluates it and accepts or refuses.
  const report = signReport(runtime, encodeGuardianReport(attestation));
  const write = writeSized(runtime, evm, { forwarder: cfg.forwarder, receiver: cfg.receiver, report, gas: cfg.gas });
  runtime.log(`wrote the attestation, gas limit ${write.gasLimit} (estimate ${write.estimate}), tx ${write.txHash}`);
  result.txHash = write.txHash;
  result.gasLimit = write.gasLimit.toString();
  if (!write.broadcast) return finish({ ...result, status: "dry-run" });

  // Simulation reports a reverted receiver as success: the forwarder's event decides.
  const receipt = readReceipt(runtime, evm, write.txHash);
  if (deliveredTo(receipt, cfg.receiver) === false) {
    throw new Error(`GuardianReceiver reverted the report in ${write.txHash} (the forwarder recorded result=false)`);
  }
  for (const ev of decodeLogsFrom(receipt, cfg.receiver, guardianReceiverAbi)) {
    if (ev.eventName === "CreditGuardUpdated") {
      result.status = "written";
      result.round = String(ev.args.round);
      runtime.log(`GuardianReceiver accepted it: feed round ${result.round}, Pay in 4 ${attestation.creditPaused ? "paused" : "open"}`);
      return finish(result);
    }
    if (ev.eventName === "AttestationRefused") {
      result.status = "refused";
      result.refusal = refusalText(ev.args.reason as Hex);
      // VerdictMismatch after a threshold change, or PoolMismatch after the pool crossed one, between the
      // read and the write: the next run reads the chain anew. isCreditPaused already applies both.
      note(`GuardianReceiver refused the attestation: ${result.refusal}`);
      return finish(result);
    }
  }
  throw new Error(`no CreditGuardUpdated or AttestationRefused from GuardianReceiver in ${write.txHash}`);
}

export const initWorkflow = (config: GuardianConfig) => [
  cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron),
];
