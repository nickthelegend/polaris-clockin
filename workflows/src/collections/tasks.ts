/**
 * What a collections run proposes, and the report it writes.
 *
 * CollectionsReceiver takes `abi.encode(uint8 kind = 1, (uint8 action, uint256 id)[] tasks)`
 * and runs each task in its own try/catch (packages/contracts/README.md):
 *
 *   action 1  PolarisLoanEngine.collectInstallment(id)
 *   action 2  PolarisPayments.chargeDue(id)
 *   action 3  PolarisLoanEngine.liquidate(id)
 *
 * Everything here is pure, so the unit tests hold it to the receiver's
 * decoder byte for byte, and the local end-to-end run holds it to the
 * receiver itself.
 */

import {
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  hexToBigInt,
  keccak256,
  numberToHex,
  parseAbiParameters,
} from "viem";

export const REPORT_KIND_COLLECTIONS = 1;

export const ACTION = {
  COLLECT_INSTALLMENT: 1,
  CHARGE_SUBSCRIPTION: 2,
  LIQUIDATE: 3,
} as const;
export type Action = (typeof ACTION)[keyof typeof ACTION];

export const ACTION_NAME: Record<number, string> = {
  1: "collect",
  2: "charge",
  3: "liquidate",
};

export interface Task {
  action: Action;
  id: bigint;
}

/** The receiver's report body, as viem parameters. */
export const COLLECTIONS_REPORT_PARAMS = parseAbiParameters("uint8 kind, (uint8 action, uint256 id)[] tasks");

export function encodeCollectionsReport(tasks: readonly Task[]): Hex {
  return encodeAbiParameters(COLLECTIONS_REPORT_PARAMS, [
    REPORT_KIND_COLLECTIONS,
    tasks.map((t) => ({ action: t.action, id: t.id })),
  ]);
}

export function decodeCollectionsReport(hex: Hex): { kind: number; tasks: Task[] } {
  const [kind, tasks] = decodeAbiParameters(COLLECTIONS_REPORT_PARAMS, hex);
  return { kind, tasks: tasks.map((t) => ({ action: t.action as Action, id: t.id })) };
}

/**
 * CRE caps one EVM read request at 5 KB (docs/research/cre.md §8). A
 * `checkTasks` call is 4 + 32 + 32 + 64 per task bytes of calldata, so 78
 * tasks is the ceiling; 72 leaves room for the request's own framing.
 */
export const MAX_CHECK_BATCH = 72;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Loan and subscription ids to check when no indexer proposes candidates:
 * the newest `recent` ids, plus a `sweep`-sized slice of the older ones that
 * moves on every run, so every id is revisited while each run stays inside
 * CRE's read quota. `tick` must be the same on every node: the cron's
 * scheduled time, not a clock read. Ids start at 1 (`++loanCount`).
 *
 * The slice starts at keccak256(tick) mod the older range. Stepping by the
 * tick itself would not do: a cron's ticks are multiples of its period, and a
 * step that shares a factor with the range revisits the same slice forever.
 */
export function chainWindow(count: bigint, recent: number, sweep: number, tick: bigint): bigint[] {
  if (count <= 0n) return [];
  const ids = new Set<bigint>();
  const newestFrom = count - BigInt(recent) + 1n > 1n ? count - BigInt(recent) + 1n : 1n;
  for (let id = newestFrom; id <= count; id++) ids.add(id);
  const older = newestFrom - 1n; // ids 1..older are not in the newest slice
  if (older > 0n && sweep > 0) {
    const span = BigInt(sweep) < older ? BigInt(sweep) : older;
    const start = hexToBigInt(keccak256(numberToHex(tick))) % older; // 0-based
    for (let k = 0n; k < span; k++) ids.add(((start + k) % older) + 1n);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface Ready {
  /** Loans whose next instalment is due. */
  collect: bigint[];
  /** Subscriptions whose period renewed. */
  charge: bigint[];
  /** Loans past grace: liquidated only if collecting fails first. */
  liquidate: bigint[];
}

/**
 * The report's tasks, at most `max`. Each due loan's collection comes first
 * and, when it is also past grace, its liquidation right after: the receiver
 * runs them in order, so a buyer who can pay is collected and the
 * liquidation is skipped as stale, and only a buyer who cannot is
 * liquidated. A loan's pair is never split across reports. Charges follow.
 * Lowest ids first, so the oldest plans are never starved.
 */
export function planTasks(ready: Ready, max: number): Task[] {
  const asc = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
  const liquidatable = new Set(ready.liquidate.map(String));
  const loans = [...new Set([...ready.collect, ...ready.liquidate].map(String))].map(BigInt).sort(asc);
  const due = new Set(ready.collect.map(String));

  const out: Task[] = [];
  for (const id of loans) {
    const group: Task[] = [];
    if (due.has(String(id))) group.push({ action: ACTION.COLLECT_INSTALLMENT, id });
    if (liquidatable.has(String(id))) group.push({ action: ACTION.LIQUIDATE, id });
    if (out.length + group.length > max) break;
    out.push(...group);
  }
  for (const id of [...new Set(ready.charge.map(String))].map(BigInt).sort(asc)) {
    if (out.length >= max) break;
    out.push({ action: ACTION.CHARGE_SUBSCRIPTION, id });
  }
  return out;
}
