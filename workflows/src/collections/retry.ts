/**
 * The instant retry: `polaris-collections`' second trigger, an EVM log
 * trigger on PolarisCheckout's `Reauthorized(address indexed buyer, uint256
 * value, uint256 deadline)`.
 *
 * A buyer whose collection was skipped for a lost allowance
 * (`InsufficientAllowance`, dunned as `allowance_lost`) signs a fresh ERC-2612
 * permit; the relayer submits it with `PolarisCheckout.reauthorize`, which
 * applies it to the loan engine and emits `Reauthorized` in the same
 * transaction. The DON hears that log and the workflow collects the buyer's
 * due instalments at once (`CollectionsReceiver.dueTasksFor(buyer)`), through
 * the same report the cron writes, instead of at the next rung of the dunning
 * ladder (6 h, then 24 h, 72 h, 168 h).
 *
 * The filter is PolarisCheckout's address and the event's topic0 alone, so
 * only that contract's event can fire it, and every buyer is covered. Only
 * the buyer can cause the event (it needs their permit signature over the
 * token's current nonce), and a run writes nothing unless an instalment is due.
 */

import { type EVMLog, bytesToHex, logTriggerConfig, protoBigIntToBigint } from "@chainlink/cre-sdk";
import { polarisCheckoutAbi } from "@polarispay/contracts/abi";
import { type Address, decodeEventLog, type Hex, toEventSelector } from "viem";
import { z } from "zod";
import { address } from "../shared/config.ts";

export const REAUTHORIZED_SIGNATURE = "Reauthorized(address,uint256,uint256)";
/** keccak256 of the signature: the log's topic0. */
export const REAUTHORIZED_TOPIC: Hex = toEventSelector(REAUTHORIZED_SIGNATURE);

/**
 * `retry` in the collections config: where to listen, or null to run on the
 * cron alone (the workflow then registers one trigger, not two).
 */
export const retrySchema = z
  .object({
    /** PolarisCheckout: the only address whose `Reauthorized` fires a run. */
    checkout: address("PolarisCheckout"),
    /**
     * How final the log's block must be before the DON acts on it: FINALIZED
     * (Monad finalizes in about 800 ms, so the retry is still seconds away,
     * and never acts on a permit a reorg removed), SAFE (the SDK's default) or
     * LATEST.
     */
    confidence: z.enum(["FINALIZED", "SAFE", "LATEST"]),
  })
  .nullable();
export type RetryConfig = NonNullable<z.infer<typeof retrySchema>>;

/** The log trigger's filter: PolarisCheckout's address, `Reauthorized` as topic0, any buyer. */
export function reauthorizedFilter(retry: RetryConfig) {
  return logTriggerConfig({ addresses: [retry.checkout], topics: [[REAUTHORIZED_TOPIC]], confidence: retry.confidence });
}

export interface Reauthorized {
  buyer: Address;
  value: bigint;
  deadline: bigint;
  /** The `reauthorize` transaction. */
  txHash: Hex;
  blockNumber: bigint | null;
  logIndex: number;
  /** The log was dropped by a reorg (only possible below FINALIZED). */
  removed: boolean;
}

/**
 * The trigger's log as a `Reauthorized` event. Throws when it is not one from
 * `checkout`: the filter already guarantees both, so this only fires on a
 * misrouted payload, and a run must never collect for a buyer it did not
 * read from the right contract.
 */
export function decodeReauthorized(log: EVMLog, checkout: Address): Reauthorized {
  const from = bytesToHex(log.address);
  if (from.toLowerCase() !== checkout.toLowerCase()) throw new Error(`log from ${from}, not PolarisCheckout ${checkout}`);
  const topics = log.topics.map((t) => bytesToHex(t)) as Hex[];
  if (topics[0]?.toLowerCase() !== REAUTHORIZED_TOPIC) throw new Error(`log topic0 ${topics[0] ?? "(none)"} is not Reauthorized`);
  const ev = decodeEventLog({ abi: polarisCheckoutAbi, eventName: "Reauthorized", topics: topics as [Hex, ...Hex[]], data: bytesToHex(log.data) });
  const args = ev.args as { buyer: Address; value: bigint; deadline: bigint };
  return {
    buyer: args.buyer,
    value: args.value,
    deadline: args.deadline,
    txHash: bytesToHex(log.txHash),
    blockNumber: log.blockNumber ? protoBigIntToBigint(log.blockNumber) : null,
    logIndex: log.index,
    removed: log.removed,
  };
}
