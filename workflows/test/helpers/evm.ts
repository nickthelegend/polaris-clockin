/**
 * Building EVM capability replies in tests: logs, receipts and hex-to-base64,
 * in the JSON shapes the SDK's mocks accept.
 */

import { hexToBase64 } from "@chainlink/cre-sdk";
import {
  type Abi,
  type AbiEvent,
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  keccak256,
  stringToHex,
} from "viem";

export const b64 = (hex: Hex | string): string => hexToBase64(hex);
export const hexOf = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString("hex")}`;

export interface TestLog {
  address: Address;
  topics: Hex[];
  data: Hex;
}

/** Encode one event the way the EVM would log it. */
export function eventLog(abi: Abi, eventName: string, address: Address, args: Record<string, unknown>): TestLog {
  const event = abi.find((x): x is AbiEvent => x.type === "event" && x.name === eventName);
  if (!event) throw new Error(`no event ${eventName}`);
  const topics = encodeEventTopics({ abi: [event], eventName, args: args as never }) as Hex[];
  const unindexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(
    unindexed,
    unindexed.map((i) => args[i.name!]),
  );
  return { address, topics, data };
}

/** A GetTransactionReceiptReplyJson carrying `logs`. */
export function receiptJson(logs: TestLog[], status = 1) {
  return {
    receipt: {
      status: String(status),
      gasUsed: "250000",
      txIndex: "0",
      logs: logs.map((l, index) => ({
        address: b64(l.address),
        topics: l.topics.map(b64),
        data: b64(l.data),
        txIndex: 0,
        index,
        removed: false,
      })),
    },
  };
}

/** A deterministic fake transaction hash for a label. */
export const fakeTxHash = (label: string): Hex => keccak256(stringToHex(label));
