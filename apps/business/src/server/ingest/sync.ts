import "server-only";

import type { Address, Log } from "viem";

import { publicClient, requireChain } from "../chain/client";
import { getDb } from "../db";
import { ingestLogs, ingestReceipt, watchedContracts } from "./ingest";

/**
 * The chain sync: read our contracts' logs block range by block range and
 * ingest them, so events nobody here sent (CRE collections, renewals and
 * liquidations; direct payments from a buyer's own wallet) still become
 * records and webhooks. The cursor only advances past a range once every
 * log in it was handled.
 *
 * This is the fallback half of plan §5.1's "Envio HyperIndex → webhooks":
 * `ingestLogs` takes logs from anywhere, so the Envio indexer can feed the
 * same function when it is deployed.
 */

const CURSOR_ID = "logs";

function chunkSize(chainId: number): number {
  const configured = Number(process.env.POLARIS_SYNC_CHUNK_BLOCKS ?? "");
  if (Number.isInteger(configured) && configured > 0) return configured;
  // Monad's public RPC caps eth_getLogs at 100 blocks (40 s of chain).
  return chainId === 31337 ? 2_000 : 100;
}

export type SyncSummary = { from: number; to: number; logs: number; events: number; caughtUp: boolean };

export async function syncChain(options: { maxRanges?: number } = {}): Promise<SyncSummary> {
  const chain = requireChain();
  const client = publicClient();
  const db = getDb();
  const latest = Number(await client.getBlockNumber());

  let cursor = await db.cursors.get(CURSOR_ID);
  if (!cursor) {
    // First run: start from the configured block, or from now (no backfill).
    const configured = Number(process.env.POLARIS_SYNC_FROM_BLOCK ?? "");
    const start = Number.isInteger(configured) && configured >= 0 ? configured : latest;
    cursor = await db.cursors.upsert({ id: CURSOR_ID, block: start - 1, updatedAt: new Date().toISOString() });
  }

  const addresses = Object.values(watchedContracts(chain)).filter((a): a is Address => a !== null);
  const size = chunkSize(chain.id);
  const first = cursor.block + 1;
  let from = first;
  let logs = 0;
  let events = 0;
  for (let i = 0; i < (options.maxRanges ?? 20) && from <= latest; i++) {
    const to = Math.min(latest, from + size - 1);
    const found = (await client.getLogs({ address: addresses, fromBlock: BigInt(from), toBlock: BigInt(to) })) as Log[];
    const summary = await ingestLogs(found);
    logs += found.length;
    events += summary.events;
    await db.cursors.upsert({ id: CURSOR_ID, block: to, updatedAt: new Date().toISOString() });
    from = to + 1;
  }
  return { from: first, to: from - 1, logs, events, caughtUp: from > latest };
}

/**
 * Finish relays whose receipt we didn't wait long enough for: fetch each
 * receipt and ingest it (which confirms the relay, pays out the payout, and
 * sends the webhooks).
 */
export async function reconcileRelays(options: { olderThanMs?: number; limit?: number } = {}): Promise<number> {
  const db = getDb();
  const client = publicClient();
  const cutoff = new Date(Date.now() - (options.olderThanMs ?? 5_000)).toISOString();
  const pending = await db.relays.find({ state: "submitted", createdAt: { lte: cutoff } }, { orderBy: "createdAt", limit: options.limit ?? 20 });
  let settled = 0;
  for (const relay of pending) {
    if (!relay.txHash) continue;
    const receipt = await client.getTransactionReceipt({ hash: relay.txHash }).catch(() => null);
    if (!receipt) continue;
    await ingestReceipt(receipt);
    settled++;
  }
  return settled;
}
