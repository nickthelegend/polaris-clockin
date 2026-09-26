/**
 * What a collections report did, read back from its receipt, and what the
 * dunning ladder should hear about it.
 *
 * CollectionsReceiver emits `TaskExecuted` or `TaskSkipped(action, id, reason)`
 * per task and one `CollectionsRun`. `reason` is the target's revert data,
 * and the loan engine reports the two shortfalls as distinct errors, so the
 * workflow can tell a buyer to sign again apart from a buyer who needs to top
 * up (plan §5.4: "it never duns a buyer for our mistake"):
 *
 *   InsufficientAllowance(have, need)   → reauthorize   installment.failed
 *   InsufficientBalance(have, need)     → top_up        installment.failed
 *   NotDue / LoanNotActive / InvalidLoan / NotLiquidatable /
 *   SubscriptionNotActive               → stale         (nobody's fault, no event)
 *   anything else                       → unknown       installment.failed (reviewed by a person)
 *
 * Subscriptions pull through the token, so their shortfalls arrive as the
 * token's ERC-20 errors and map the same way.
 */

import { polarisLoanEngineAbi, polarisPaymentsAbi } from "@polarispay/contracts/abi";
import { type Abi, type Address, decodeErrorResult, type Hex, parseAbi } from "viem";
import { decodeLogsFrom, type ReceiptView } from "../shared/evm.ts";
import { ACTION, type Action, ACTION_NAME } from "./tasks.ts";

export type SkipClass = "reauthorize" | "top_up" | "stale" | "unknown";

const TOKEN_ERRORS = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error UnknownAction(uint8 action)",
]);

const RECEIVER_EVENTS = parseAbi([
  "event TaskExecuted(uint8 indexed action, uint256 indexed id, uint256 amount)",
  "event TaskSkipped(uint8 indexed action, uint256 indexed id, bytes reason)",
  "event CollectionsRun(uint256 tasks, uint256 executed, uint256 skipped)",
]);

/** Every error a task's target can revert with, for decoding `TaskSkipped.reason`. */
const TARGET_ERRORS: Abi = [
  ...polarisLoanEngineAbi.filter((x) => x.type === "error"),
  ...polarisPaymentsAbi.filter((x) => x.type === "error"),
  ...TOKEN_ERRORS,
];

const STALE = new Set(["NotDue", "LoanNotActive", "InvalidLoan", "NotLiquidatable", "SubscriptionNotActive"]);

export interface SkipReason {
  class: SkipClass;
  /** The decoded error's name, or `unknown(0x12345678)`. */
  error: string;
  /** What the buyer holds (balance or allowance) and what the task needed, when the error says. */
  have: bigint | null;
  need: bigint | null;
}

/** Classify a `TaskSkipped.reason`. */
export function classifySkip(reason: Hex): SkipReason {
  if (reason === "0x" || reason.length < 10) return { class: "unknown", error: "empty revert", have: null, need: null };
  try {
    const d = decodeErrorResult({ abi: TARGET_ERRORS, data: reason });
    const args = (d.args ?? []) as readonly unknown[];
    switch (d.errorName) {
      case "InsufficientAllowance":
        return { class: "reauthorize", error: d.errorName, have: args[0] as bigint, need: args[1] as bigint };
      case "InsufficientBalance":
        return { class: "top_up", error: d.errorName, have: args[0] as bigint, need: args[1] as bigint };
      case "ERC20InsufficientAllowance":
        return { class: "reauthorize", error: d.errorName, have: args[1] as bigint, need: args[2] as bigint };
      case "ERC20InsufficientBalance":
        return { class: "top_up", error: d.errorName, have: args[1] as bigint, need: args[2] as bigint };
      default:
        return { class: STALE.has(d.errorName) ? "stale" : "unknown", error: d.errorName, have: null, need: null };
    }
  } catch {
    return { class: "unknown", error: `unknown(${reason.slice(0, 10)})`, have: null, need: null };
  }
}

export interface Executed {
  action: Action;
  id: bigint;
  /** What a collection delivered; 0 for charges and liquidations. */
  amount: bigint;
}

export interface Skipped extends SkipReason {
  action: Action;
  id: bigint;
}

export interface RunOutcome {
  executed: Executed[];
  skipped: Skipped[];
  /** The receiver's own tally, or null if it emitted none (it reverted). */
  tally: { tasks: bigint; executed: bigint; skipped: bigint } | null;
}

/** Everything CollectionsReceiver said in this receipt. */
export function outcomeFromReceipt(receipt: ReceiptView, receiver: Address): RunOutcome {
  const out: RunOutcome = { executed: [], skipped: [], tally: null };
  for (const ev of decodeLogsFrom(receipt, receiver, RECEIVER_EVENTS)) {
    const a = ev.args;
    if (ev.eventName === "TaskExecuted") {
      out.executed.push({ action: Number(a.action) as Action, id: a.id as bigint, amount: a.amount as bigint });
    } else if (ev.eventName === "TaskSkipped") {
      out.skipped.push({ action: Number(a.action) as Action, id: a.id as bigint, ...classifySkip(a.reason as Hex) });
    } else if (ev.eventName === "CollectionsRun") {
      out.tally = { tasks: a.tasks as bigint, executed: a.executed as bigint, skipped: a.skipped as bigint };
    }
  }
  return out;
}

/**
 * The events the Polaris API turns into merchant webhooks and buyer
 * notifications (plan §5.8's names). Amounts are decimal strings in 6-decimal
 * base units. `id` is stable across retries, so delivery can be
 * at-least-once.
 */
export type CollectionsEvent =
  | { id: string; type: "installment.collected"; loanId: string; amount: string }
  | {
      id: string;
      type: "installment.failed";
      loanId: string;
      reason: Exclude<SkipClass, "stale">;
      error: string;
      have: string | null;
      need: string | null;
    }
  | { id: string; type: "subscription.charged"; subscriptionId: string }
  | {
      id: string;
      type: "subscription.charge_failed";
      subscriptionId: string;
      reason: Exclude<SkipClass, "stale">;
      error: string;
      have: string | null;
      need: string | null;
    }
  | { id: string; type: "plan.liquidated"; loanId: string };

const str = (v: bigint | null) => (v === null ? null : v.toString());

/** One event per task that moved money or needs a person; stale skips say nothing. */
export function eventsFor(txHash: Hex, outcome: RunOutcome): CollectionsEvent[] {
  const events: CollectionsEvent[] = [];
  const id = (kind: string, n: bigint) => `${txHash}:${kind}:${n}`;
  for (const e of outcome.executed) {
    if (e.action === ACTION.COLLECT_INSTALLMENT) {
      events.push({ id: id("collect", e.id), type: "installment.collected", loanId: e.id.toString(), amount: e.amount.toString() });
    } else if (e.action === ACTION.CHARGE_SUBSCRIPTION) {
      events.push({ id: id("charge", e.id), type: "subscription.charged", subscriptionId: e.id.toString() });
    } else if (e.action === ACTION.LIQUIDATE) {
      events.push({ id: id("liquidate", e.id), type: "plan.liquidated", loanId: e.id.toString() });
    }
  }
  for (const s of outcome.skipped) {
    if (s.class === "stale") continue;
    const common = { reason: s.class, error: s.error, have: str(s.have), need: str(s.need) };
    if (s.action === ACTION.COLLECT_INSTALLMENT) {
      events.push({ id: id("collect", s.id), type: "installment.failed", loanId: s.id.toString(), ...common });
    } else if (s.action === ACTION.CHARGE_SUBSCRIPTION) {
      events.push({ id: id("charge", s.id), type: "subscription.charge_failed", subscriptionId: s.id.toString(), ...common });
    }
    // A liquidation that fails is not the buyer's to fix; the run log keeps it.
  }
  return events;
}

/** A one-line summary for the workflow log (CRE caps a log line at 1 KB). */
export function summarize(outcome: RunOutcome): string {
  const parts = [
    ...outcome.executed.map((e) => `${ACTION_NAME[e.action]} #${e.id} ok`),
    ...outcome.skipped.map((s) => `${ACTION_NAME[s.action]} #${s.id} ${s.class} (${s.error})`),
  ];
  const line = parts.join("; ");
  return line.length > 900 ? `${line.slice(0, 897)}...` : line;
}
