import {
  decodeFunctionData,
  getAddress,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseTransaction,
  RawContractError,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";

/**
 * A stand-in for viem's PublicClient, with just the calls the server makes.
 * It really parses the signed transactions the relayer sends (so the tests
 * see the gas limit, the nonce and the calldata that would hit the chain) and
 * lets each test decide what a call returns, reverts with, or emits.
 */

export type SentTx = { hash: Hex; to: Address; data: Hex; gas: bigint; nonce: number; chainId: number; value: bigint; functionName: string; args: readonly unknown[] };

export type LogSpec = { address: Address; abi: Abi; eventName: string; args: Record<string, unknown> };

export function makeLog(spec: LogSpec, meta: { txHash: Hex; logIndex: number; blockNumber: bigint }): Log {
  const event = spec.abi.find((x) => x.type === "event" && x.name === spec.eventName) as
    | { inputs: readonly { name: string; type: string; indexed?: boolean }[] }
    | undefined;
  if (!event) throw new Error(`no event ${spec.eventName}`);
  const topics = encodeEventTopics({ abi: spec.abi, eventName: spec.eventName, args: spec.args } as never) as Hex[];
  const data = encodeAbiParameters(
    event.inputs.filter((i) => !i.indexed) as never,
    event.inputs.filter((i) => !i.indexed).map((i) => spec.args[i.name]) as never,
  );
  return {
    address: spec.address,
    topics: topics as [Hex, ...Hex[]],
    data,
    logIndex: meta.logIndex,
    transactionHash: meta.txHash,
    transactionIndex: 0,
    blockNumber: meta.blockNumber,
    blockHash: `0x${"ab".repeat(32)}` as Hex,
    removed: false,
  } as Log;
}

export class FakeChain {
  blockNumber = 100n;
  timestamp = BigInt(Math.floor(Date.now() / 1000));
  sent: SentTx[] = [];
  receipts = new Map<string, TransactionReceipt>();
  /** Revert data for the next simulated call, by function name. */
  reverts = new Map<string, Hex>();
  reads: Record<string, (args: readonly unknown[]) => unknown> = {};
  /** What eth_feeHistory would suggest. */
  fees = { maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  /** What a sent transaction emits. */
  onSend: (tx: SentTx, fn: { functionName: string; args: readonly unknown[] }) => LogSpec[] = () => [];
  abis: Abi[] = [];
  logs: Log[] = [];

  constructor(abis: Abi[]) {
    this.abis = abis;
  }

  /** What was relayed for someone, without the operator's price quotes (one per checkout session). */
  get relayed(): SentTx[] {
    return this.sent.filter((t) => t.functionName !== "quoteOrder");
  }

  /** The price quotes the relayer pinned, as (merchant, orderKey, amount). */
  get quotes(): Array<{ merchant: Address; orderKey: Hex; amount: bigint }> {
    return this.sent.filter((t) => t.functionName === "quoteOrder").map((t) => {
      const [merchant, orderKey, amount] = t.args as [Address, Hex, bigint];
      return { merchant, orderKey, amount };
    });
  }

  private decode(data: Hex): { functionName: string; args: readonly unknown[] } {
    for (const abi of this.abis) {
      try {
        const d = decodeFunctionData({ abi, data });
        return { functionName: d.functionName, args: (d.args ?? []) as readonly unknown[] };
      } catch {
        // next
      }
    }
    return { functionName: "unknown", args: [] };
  }

  client() {
    return {
      call: async ({ data }: { data: Hex }) => {
        const { functionName } = this.decode(data);
        const revert = this.reverts.get(functionName);
        if (revert) throw new RawContractError({ data: revert });
        return { data: "0x" };
      },
      estimateGas: async () => {
        return 200_000n;
      },
      estimateFeesPerGas: async () => {
        return this.fees;
      },
      getTransactionCount: async () => {
        return this.sent.length;
      },
      sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
        const tx = parseTransaction(serializedTransaction);
        const hash = keccak256(serializedTransaction);
        const fn = this.decode(tx.data as Hex);
        const sent: SentTx = {
          hash,
          to: getAddress(tx.to as Address),
          data: tx.data as Hex,
          gas: tx.gas as bigint,
          nonce: tx.nonce as number,
          chainId: tx.chainId as number,
          value: tx.value ?? 0n,
          functionName: fn.functionName,
          args: fn.args,
        };
        this.sent.push(sent);
        this.blockNumber += 1n;
        const specs = this.onSend(sent, fn);
        const logs = specs.map((spec, i) => makeLog(spec, { txHash: hash, logIndex: i, blockNumber: this.blockNumber }));
        this.logs.push(...logs);
        this.receipts.set(hash, {
          transactionHash: hash,
          status: "success",
          blockNumber: this.blockNumber,
          logs,
        } as unknown as TransactionReceipt);
        return hash;
      },
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const r = this.receipts.get(hash);
        if (!r) throw new Error("no receipt");
        return r;
      },
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const r = this.receipts.get(hash);
        if (!r) throw new Error("no receipt");
        return r;
      },
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        const fn = this.reads[functionName];
        if (!fn) throw new Error(`FakeChain: no read for ${functionName}`);
        return fn(args ?? []);
      },
      getBlock: async () => {
        return { timestamp: this.timestamp };
      },
      getBlockNumber: async () => {
        return this.blockNumber;
      },
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        return this.logs.filter((l) => (l.blockNumber as bigint) >= fromBlock && (l.blockNumber as bigint) <= toBlock);
      },
    };
  }
}
