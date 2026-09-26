/**
 * The webhook dispatcher's side: page the Activity outbox by cursor and turn
 * each row into the event body a merchant receives (plan 5.8). Signing,
 * delivery and retries stay with the dispatcher (packages/db/src/webhooks.ts);
 * this only decides what is sent and in what order.
 *
 * Only rows at or below the indexer's progress block are returned: Envio
 * writes a block's rows and its progress in one transaction, so a row the
 * dispatcher sees is never taken back. With the config's block_lag of 2
 * (Monad finality), a block is final before it is indexed.
 */

import type { Activity, PaymentMode, ReasonAction, WebhookKind } from "./types.js";

export type WebhookEvent = {
  /** Stable and unique: evt_<cursor>. A redelivery carries the same id. */
  id: string;
  type: WebhookKind;
  /** Unix seconds of the block that caused it. */
  created: number;
  /** The Activity cursor, for resuming. */
  cursor: string;
  data: {
    merchant: string;
    /** The payment id (order key), loan id, subscription id or payout id. */
    id: string;
    orderId?: string;
    orderKey?: string;
    buyer?: string;
    mode?: PaymentMode;
    /** AUSD base units (6 decimals), as a decimal string. */
    amount: string;
    fee?: string;
    currency: "ausd";
    installmentIndex?: number;
    reason?: string;
    reasonAction?: ReasonAction;
    destination?: string;
    transaction: { hash: string; blockNumber: number; logIndex: number };
  };
};

export function toWebhookEvent(a: Activity): WebhookEvent {
  const data: WebhookEvent["data"] = {
    merchant: a.merchant_id,
    id: a.refId,
    amount: a.amount.toString(),
    currency: "ausd",
    transaction: { hash: a.txHash, blockNumber: a.blockNumber, logIndex: a.logIndex },
  };
  if (a.orderId) data.orderId = a.orderId;
  if (a.orderKey) data.orderKey = a.orderKey;
  if (a.buyer) data.buyer = a.buyer;
  if (a.mode) data.mode = a.mode;
  if (a.fee !== null && a.fee !== undefined) data.fee = a.fee.toString();
  if (a.installmentIndex !== null && a.installmentIndex !== undefined) data.installmentIndex = a.installmentIndex;
  if (a.reason) data.reason = a.reason;
  if (a.reasonAction) data.reasonAction = a.reasonAction;
  if (a.destination) data.destination = a.destination;
  return { id: `evt_${a.cursor}`, type: a.kind, created: a.timestamp, cursor: a.cursor.toString(), data };
}

/** Keep rows the indexer has fully committed (at or below its progress block). */
export function committed(activities: readonly Activity[], progressBlock: number | null): Activity[] {
  if (progressBlock === null) return [];
  return activities.filter((a) => a.blockNumber <= progressBlock);
}

/** The cursor to resume from after a page: the last one delivered, or the one passed in. */
export function nextCursor(after: bigint, delivered: readonly Activity[]): bigint {
  return delivered.reduce((c, a) => (a.cursor > c ? a.cursor : c), after);
}
