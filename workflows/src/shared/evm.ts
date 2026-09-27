/**
 * EVM plumbing both workflows use: reads, the gas limit, the write, and the
 * receipt the write left behind.
 *
 * Two CRE facts shape this file (docs/research/cre.md):
 *   - Monad bills the gas *limit*. So a report's limit is sized from an
 *     estimate of the signed report itself, plus 15%, clamped (plan §5.3).
 *     Never the 10M cap.
 *   - Under `cre workflow simulate`, a receiver that reverts still reads as
 *     success (§6.4): the mock forwarder swallows the revert. So after every
 *     write the receipt is read back and the forwarder's own
 *     `ReportProcessed(..., result)` decides, not the write status alone.
 */

import {
  bytesToHex,
  cre,
  encodeCallMsg,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type Report,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import {
  type Abi,
  type Address,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  parseAbi,
  sha256,
  stringToHex,
  zeroAddress,
} from "viem";
import type { GasConfig } from "./config.ts";

export type EVMClient = InstanceType<typeof cre.capabilities.EVMClient>;

/** `ReceiverContractExecutionStatus.REVERTED` in the EVM capability's proto. */
const RECEIVER_REVERTED = 1;

/** The EVM client for a CRE chain name (`monad-testnet`). */
export function evmClientFor(chainSelectorName: string): EVMClient {
  const selectors = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS as Record<string, bigint>;
  const selector = selectors[chainSelectorName];
  if (selector === undefined) throw new Error(`CRE has no EVM capability for chain "${chainSelectorName}"`);
  return new cre.capabilities.EVMClient(selector);
}

/**
 * One `eth_call` through the EVM capability: raw calldata in, raw return
 * data out. Reads the last finalized block by default: every node of the DON
 * sees the same state there, and on Monad it is 800 ms behind the head.
 */
export function callRaw(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  to: Address,
  data: Hex,
  block: typeof LAST_FINALIZED_BLOCK_NUMBER = LAST_FINALIZED_BLOCK_NUMBER,
): Hex {
  const reply = evm.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: block }).result();
  return bytesToHex(reply.data);
}

/**
 * A typed view call: encode with viem, one EVM read, decode with viem.
 * `abi` should be a narrow `parseAbi([...])` fragment, so the bundle stays
 * small and the return type is exact.
 */
export function readContract<const TAbi extends Abi>(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  call: { address: Address; abi: TAbi; functionName: string; args?: readonly unknown[] },
): unknown {
  const data = encodeFunctionData({ abi: call.abi as Abi, functionName: call.functionName, args: call.args ?? [] });
  const raw = callRaw(runtime, evm, call.address, data);
  return decodeFunctionResult({ abi: call.abi as Abi, functionName: call.functionName, data: raw });
}

/**
 * A workflow name as the forwarder carries it: the first 10 hex characters of
 * sha256(name), as ten ASCII bytes. `polaris-collections` →
 * 0x38323961376630323863 (packages/contracts/lib/cre.js does the same).
 */
export function workflowNameBytes10(name: string): Hex {
  return stringToHex(sha256(stringToHex(name)).slice(2, 12));
}

const RECEIVER_ABI = parseAbi(["function onReport(bytes metadata, bytes report)"]);
const FORWARDER_REPORT_ABI = parseAbi([
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
]);

/** Sign `payload` as a DON report: 109-byte header (workflow id, name, owner, …) + payload. */
export function signReport(runtime: Runtime<unknown>, payload: Hex): Report {
  return runtime.report(prepareReportRequest(payload)).result();
}

/** The two halves a forwarder hands `onReport`: rawReport[45:109] and rawReport[109:]. */
export function splitReport(report: Report): { metadata: Hex; body: Hex } {
  const raw = bytesToHex(report.rawReport());
  return { metadata: `0x${raw.slice(2 + 45 * 2, 2 + 109 * 2)}`, body: `0x${raw.slice(2 + 109 * 2)}` };
}

/**
 * Gas `onReport` needs, estimated as the forwarder calls it: from the
 * forwarder's address, with this report's own metadata (so a production
 * receiver's author and name checks pass as they will on delivery).
 *
 * Estimated at the receiver, not at the forwarder: a forwarder catches the
 * receiver's revert, so an estimate of `forwarder.report` can settle on a
 * limit where the receiver runs out of gas inside the catch and the
 * transaction still "succeeds". Our receivers revert the whole report when a
 * task runs out of gas, so this estimate cannot be fooled that way.
 */
export function estimateOnReport(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  p: { forwarder: Address; receiver: Address; report: Report },
): bigint {
  const { metadata, body } = splitReport(p.report);
  const data = encodeFunctionData({ abi: RECEIVER_ABI, functionName: "onReport", args: [metadata, body] });
  return evm.estimateGas(runtime, { msg: encodeCallMsg({ from: p.forwarder, to: p.receiver, data }) }).result().gas;
}

/**
 * Gas for the whole delivery, `forwarder.report(...)` sent by `from`. For a
 * receiver that also checks the transaction's origin (UnderwritingReceiver's
 * simulation transmitter), which an estimate from the forwarder's address
 * cannot satisfy. Only for small reports: see `estimateOnReport` for why a
 * forwarder-level estimate can undershoot a large one.
 */
export function estimateDelivery(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  p: { forwarder: Address; receiver: Address; report: Report; from: Address },
): bigint {
  const r = p.report.x_generatedCodeOnly_unwrap();
  const data = encodeFunctionData({
    abi: FORWARDER_REPORT_ABI,
    functionName: "report",
    args: [p.receiver, bytesToHex(r.rawReport), bytesToHex(r.reportContext), r.sigs.map((sig) => bytesToHex(sig.signature))],
  });
  return evm.estimateGas(runtime, { msg: encodeCallMsg({ from: p.from, to: p.forwarder, data }) }).result().gas;
}

/**
 * The limit to send with: the estimate, plus `overhead` when the estimate
 * covered `onReport` alone (the forwarder's own work and the intrinsic
 * cost), plus headroom, clamped to [min, max].
 */
export function gasLimitFor(estimate: bigint, gas: GasConfig, scope: "receiver" | "delivery" = "receiver"): bigint {
  const base = scope === "receiver" ? estimate + BigInt(gas.overhead) : estimate;
  const raw = (base * BigInt(10_000 + gas.headroomBps)) / 10_000n;
  const min = BigInt(gas.min);
  const max = BigInt(gas.max);
  return raw < min ? min : raw > max ? max : raw;
}

export interface WriteOutcome {
  txHash: Hex;
  gasLimit: bigint;
  /** False only under a dry-run simulation, which returns a zero hash. */
  broadcast: boolean;
}

/**
 * Write a signed report to `receiver` through the forwarder with a sized gas
 * limit. Throws on anything but a landed, non-reverted transaction.
 */
export function submitReport(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  p: { receiver: Address; report: Report; gasLimit: bigint },
): WriteOutcome {
  const write = evm
    .writeReport(runtime, {
      receiver: p.receiver,
      report: p.report,
      gasConfig: { gasLimit: p.gasLimit.toString() },
    })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report write failed: ${TxStatus[write.txStatus] ?? write.txStatus} ${write.errorMessage ?? ""}`.trim());
  }
  if (write.receiverContractExecutionStatus === RECEIVER_REVERTED) {
    throw new Error(`receiver ${p.receiver} reverted the report ${write.errorMessage ?? ""}`.trim());
  }
  const txHash = bytesToHex(write.txHash ?? new Uint8Array(32));
  return { txHash, gasLimit: p.gasLimit, broadcast: !/^0x0+$/.test(txHash) };
}

export interface ReceiptLog {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
}

export interface ReceiptView {
  status: bigint;
  gasUsed: bigint;
  logs: ReceiptLog[];
}

/** The receipt of a write, with its logs as hex, for decoding with viem. */
export function readReceipt(runtime: Runtime<unknown>, evm: EVMClient, txHash: Hex): ReceiptView {
  const reply = evm.getTransactionReceipt(runtime, { hash: hexToBase64(txHash) }).result();
  const r = reply.receipt;
  if (!r) throw new Error(`no receipt for ${txHash}`);
  return {
    status: r.status,
    gasUsed: r.gasUsed,
    logs: r.logs
      .filter((l) => l.topics.length > 0)
      .map((l) => ({
        address: bytesToHex(l.address) as Address,
        topics: l.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
        data: bytesToHex(l.data),
      })),
  };
}

const FORWARDER_ABI = parseAbi([
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

/**
 * What the forwarder said about delivering to `receiver`: true (delivered),
 * false (the receiver reverted, which simulation still calls a success), or
 * null when the receipt carries no such event.
 */
export function deliveredTo(receipt: ReceiptView, receiver: Address): boolean | null {
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: FORWARDER_ABI, data: log.data, topics: log.topics });
      if (ev.args.receiver.toLowerCase() === receiver.toLowerCase()) return ev.args.result;
    } catch {
      // not a ReportProcessed log
    }
  }
  return null;
}

/** Every log `address` emitted in `receipt` that `abi` describes, decoded. */
export function decodeLogsFrom<const TAbi extends Abi>(receipt: ReceiptView, address: Address, abi: TAbi) {
  const out: Array<{ eventName: string; args: Record<string, unknown> }> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: abi as Abi, data: log.data, topics: log.topics });
      out.push({ eventName: String(ev.eventName), args: (ev.args ?? {}) as unknown as Record<string, unknown> });
    } catch {
      // an event this ABI does not describe
    }
  }
  return out;
}

/** Unix seconds from the runtime's clock: DON time in a DON, never the node's own. */
export function nowSeconds(runtime: { now(): Date }): number {
  return Math.floor(runtime.now().getTime() / 1000);
}
