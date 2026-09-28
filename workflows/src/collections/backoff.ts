/**
 * The dunning ladder when the chain proposes the candidates.
 *
 * With the indexer, a buyer who is short is retried on the ladder: after each
 * failed collection the indexer moves the plan's `nextAttemptAt` 6 h, then
 * 24 h, 72 h and 168 h on (the last step repeats; packages/indexer's
 * `dunningRetrySeconds`), and the candidate query only returns plans whose
 * attempt has come. The chain keeps no failure history, and CRE reads logs
 * 100 blocks at a time (about 40 s on Monad), so the fallback cannot see the
 * last failure. It keeps the ladder anyway, counted from the moment the
 * instalment (or renewal) fell due, which the chain does know:
 *
 *   rung 0  = dueAt                     (the first attempt)
 *   rung 1  = rung 0 + ladder[0]        (6 h later)
 *   rung 2  = rung 1 + ladder[1]        (24 h later)
 *   rung k  = rung k-1 + ladder[min(k-1, last)]
 *
 * A task is attempted only by a run whose scheduled time falls within
 * `windowSeconds` after a rung: set the window to the time between runs and
 * each rung gets one attempt (a deployed cron's scheduled times are exact; a
 * simulate loop's drift by a few seconds, so a rung may get two, or its
 * window may be missed and the next rung takes over). When every attempt
 * lands on its rung this is the indexer's own schedule, which counts from
 * each failure.
 *
 * Two things never wait on the ladder, as with the indexer: a loan past
 * grace (collection, then liquidation if it fails; the ladder never waits
 * past liquidation) and a subscription past its 7-day charge window
 * (`chargeDue` then records the miss and moves on).
 *
 * Everything here is pure; the workflow reads `dueAt` with one EVM read per
 * task.
 */

import { z } from "zod";

/** The indexer's ladder (packages/indexer/src/deployment.ts `dunningRetrySeconds`): 6 h, 24 h, 72 h, 168 h. */
export const DEFAULT_LADDER_SECONDS = [21_600, 86_400, 259_200, 604_800] as const;

/** PolarisPayments.CHARGE_WINDOW: past it, a charge records a miss instead of pulling. */
export const SUBSCRIPTION_CHARGE_WINDOW_SECONDS = 7 * 86_400;

export const chainBackoffSchema = z
  .object({
    /** Wait after the nth attempt before the next; the last step repeats. */
    ladderSeconds: z.array(z.number().int().min(60)).min(1).max(12),
    /** How long after each rung a run may attempt it: the time between runs. */
    windowSeconds: z.number().int().min(30).max(7 * 86_400),
  })
  .nullable();
export type ChainBackoff = NonNullable<z.infer<typeof chainBackoffSchema>>;

/**
 * Whether a run scheduled at `now` may attempt a task that fell due at
 * `dueAt`: true inside `[rung, rung + window)` of some rung, false before
 * `dueAt` and between rungs.
 */
export function onRung(now: number, dueAt: number, b: ChainBackoff): boolean {
  if (now < dueAt) return false;
  let rung = dueAt;
  for (let k = 0; rung <= now; k++) {
    if (now < rung + b.windowSeconds) return true;
    rung += b.ladderSeconds[Math.min(k, b.ladderSeconds.length - 1)]!;
  }
  return false;
}

/** The first rung at or after `now` (the next attempt a held-back task gets). */
export function nextRung(now: number, dueAt: number, b: ChainBackoff): number {
  let rung = dueAt;
  for (let k = 0; rung < now; k++) rung += b.ladderSeconds[Math.min(k, b.ladderSeconds.length - 1)]!;
  return rung;
}

/** When a loan's next unpaid instalment fell due: `installmentDueAt(id, installmentsPaid)`. */
export function instalmentDueAt(loan: { startedAt: bigint | number; intervalSeconds: bigint | number; installmentsPaid: number }): number {
  return Number(loan.startedAt) + (loan.installmentsPaid + 1) * Number(loan.intervalSeconds);
}

export type BackoffVerdict =
  /** Attempt it this run. */
  | { attempt: true; why: "on-rung" | "past-grace" | "past-charge-window" }
  /** Hold it back until `nextAttemptAt`. */
  | { attempt: false; nextAttemptAt: number };

/** A due loan's collection: on its rung, or past grace (liquidation follows a failed collection). */
export function loanVerdict(now: number, dueAt: number, liquidatable: boolean, b: ChainBackoff): BackoffVerdict {
  if (liquidatable) return { attempt: true, why: "past-grace" };
  if (onRung(now, dueAt, b)) return { attempt: true, why: "on-rung" };
  return { attempt: false, nextAttemptAt: nextRung(now, dueAt, b) };
}

/** A due subscription's charge: on its rung, or past the charge window (where it records the miss). */
export function subscriptionVerdict(now: number, nextChargeAt: number, b: ChainBackoff): BackoffVerdict {
  const windowEnd = nextChargeAt + SUBSCRIPTION_CHARGE_WINDOW_SECONDS;
  if (now > windowEnd) return { attempt: true, why: "past-charge-window" };
  if (onRung(now, nextChargeAt, b)) return { attempt: true, why: "on-rung" };
  // As the indexer caps its wait: never past the moment the window closes.
  return { attempt: false, nextAttemptAt: Math.min(nextRung(now, nextChargeAt, b), windowEnd + 1) };
}
