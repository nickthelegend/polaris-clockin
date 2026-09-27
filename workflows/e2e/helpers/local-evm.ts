/**
 * The EVM capability, answered by a real chain: a local Hardhat node.
 *
 * CRE capability calls are synchronous (`.result()`), so this bridge speaks
 * JSON-RPC synchronously, one `curl` per call. It plays what
 * `cre workflow simulate --broadcast` plays (the CLI's FakeEVMChain):
 *
 *   callContract / estimateGas   eth_call / eth_estimateGas ("finalized" reads the head: a local node has no lag)
 *   writeReport                  MockKeystoneForwarder.report(receiver, rawReport, context, sigs),
 *                                sent by the broadcasting key with the workflow's gas limit, and
 *                                reported as SUCCESS whenever the transaction landed, even if the
 *                                receiver reverted inside it: exactly the simulator's masking,
 *                                which the workflows must see through.
 *   getTransactionReceipt        eth_getTransactionReceipt
 */

import { hexToBase64 } from "@chainlink/cre-sdk";
import type { EvmMock } from "@chainlink/cre-sdk/test";
import { type Address, encodeFunctionData, type Hex, parseAbi } from "viem";
import { childProcess } from "../../test/helpers/host.ts";

const hex = (bytes: Uint8Array | undefined): Hex => `0x${Buffer.from(bytes ?? new Uint8Array()).toString("hex")}`;

export function rpcSync<T = unknown>(url: string, method: string, params: unknown[] = []): T {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
  const out = childProcess.execFileSync("curl", ["-s", "-S", "-X", "POST", "-H", "content-type: application/json", "--data-binary", "@-", url], {
    input: body,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const res = JSON.parse(out) as { result?: T; error?: { message: string; data?: unknown } };
  if (res.error) {
    const e = new Error(`${method}: ${res.error.message}`) as Error & { data?: unknown };
    e.data = res.error.data;
    throw e;
  }
  return res.result as T;
}

const FORWARDER_ABI = parseAbi(["function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)"]);

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: Hex;
  transactionIndex: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  blockHash: Hex;
}
interface RpcReceipt {
  status: Hex;
  gasUsed: Hex;
  transactionIndex: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  logs: RpcLog[];
}

export interface BridgeRecord {
  writes: Array<{ receiver: Address; txHash: Hex; gasLimit: bigint; gasUsed: bigint; body: Hex }>;
  reads: number;
}

/** Route the SDK's EVM mock to the node at `url`. */
export function bridgeEvm(evm: EvmMock, p: { url: string; forwarder: Address; transmitter: Address }): BridgeRecord {
  const record: BridgeRecord = { writes: [], reads: 0 };
  evm.callContract = (req) => {
    record.reads++;
    const result = rpcSync<Hex>(p.url, "eth_call", [{ from: hex(req.call?.from), to: hex(req.call?.to), data: hex(req.call?.data) }, "latest"]);
    return { data: hexToBase64(result) };
  };
  evm.estimateGas = (req) => {
    record.reads++;
    const gas = rpcSync<Hex>(p.url, "eth_estimateGas", [{ from: hex(req.msg?.from), to: hex(req.msg?.to), data: hex(req.msg?.data) }]);
    return { gas: BigInt(gas).toString() };
  };
  evm.writeReport = (req) => {
    const receiver = hex(req.receiver) as Address;
    const raw = hex(req.report?.rawReport);
    const sigs = (req.report?.sigs ?? []).map((s) => hex(s.signature));
    const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: "report", args: [receiver, raw, hex(req.report?.reportContext), sigs] });
    const gasLimit = req.gasConfig?.gasLimit ?? 0n;
    const txHash = rpcSync<Hex>(p.url, "eth_sendTransaction", [{ from: p.transmitter, to: p.forwarder, data, gas: gasLimit }]);
    const receipt = rpcSync<RpcReceipt>(p.url, "eth_getTransactionReceipt", [txHash]);
    record.writes.push({ receiver, txHash, gasLimit, gasUsed: BigInt(receipt.gasUsed), body: `0x${raw.slice(2 + 218)}` });
    return {
      txStatus: receipt.status === "0x1" ? "TX_STATUS_SUCCESS" : "TX_STATUS_REVERTED",
      receiverContractExecutionStatus: "RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS",
      txHash: hexToBase64(txHash),
    };
  };
  evm.getTransactionReceipt = (req) => {
    record.reads++;
    const r = rpcSync<RpcReceipt>(p.url, "eth_getTransactionReceipt", [hex(req.hash)]);
    return {
      receipt: {
        status: BigInt(r.status).toString(),
        gasUsed: BigInt(r.gasUsed).toString(),
        txIndex: BigInt(r.transactionIndex).toString(),
        blockHash: hexToBase64(r.blockHash),
        txHash: hexToBase64(r.transactionHash),
        logs: r.logs.map((l) => ({
          address: hexToBase64(l.address),
          topics: l.topics.map((t) => hexToBase64(t)),
          data: hexToBase64(l.data),
          txHash: hexToBase64(l.transactionHash),
          blockHash: hexToBase64(l.blockHash),
          txIndex: Number(BigInt(l.transactionIndex)),
          index: Number(BigInt(l.logIndex)),
          removed: false,
        })),
      },
    };
  };
  return record;
}

/** The latest block's timestamp, in milliseconds: the DON clock the runtime should show. */
export function chainNowMs(url: string): number {
  const block = rpcSync<{ timestamp: Hex }>(url, "eth_getBlockByNumber", ["latest", false]);
  return Number(BigInt(block.timestamp)) * 1000;
}

export function travel(url: string, seconds: number): void {
  rpcSync(url, "evm_increaseTime", [seconds]);
  rpcSync(url, "evm_mine", []);
}

/** Send a transaction from an unlocked node account and require it to succeed. */
export function sendTx(url: string, tx: { from: Address; to: Address; data: Hex }): RpcReceipt {
  const hash = rpcSync<Hex>(url, "eth_sendTransaction", [tx]);
  const receipt = rpcSync<RpcReceipt>(url, "eth_getTransactionReceipt", [hash]);
  if (receipt.status !== "0x1") throw new Error(`transaction to ${tx.to} reverted`);
  return receipt;
}

export function call(url: string, to: Address, data: Hex): Hex {
  return rpcSync<Hex>(url, "eth_call", [{ to, data }, "latest"]);
}
