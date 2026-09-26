import type { Micros } from "../money";
import type { PlanOffer } from "./types";

export const DAY = 86_400;
export const WEEK = 7 * DAY;
export const YEAR = 365 * DAY;

/**
 * Pay in 4 pricing: simple interest at `aprBps`, pro-rated over the plan's
 * length, in integer base units like the loan engine. $200 at 10% over four
 * weekly instalments is $1.53 of interest: 4 × $50.38, the last one absorbing
 * the rounding.
 */
export function quotePlan(principal: Micros, installments: number, interval: number, aprBps: number): PlanOffer {
  const n = BigInt(installments);
  const interest = (principal * BigInt(aprBps) * n * BigInt(interval)) / (10_000n * BigInt(YEAR));
  const total = principal + interest;
  const each = total / n;
  const amounts = Array.from({ length: installments }, (_, i) =>
    i === installments - 1 ? total - each * (n - 1n) : each,
  );
  return { installments, interval, aprBps, amounts, total, interest };
}

/** "every week", "every 2 weeks", "every month". */
export function describeInterval(seconds: number): string {
  if (seconds % (30 * DAY) === 0) {
    const months = seconds / (30 * DAY);
    return months === 1 ? "every month" : `every ${months} months`;
  }
  if (seconds % WEEK === 0) {
    const weeks = seconds / WEEK;
    return weeks === 1 ? "every week" : `every ${weeks} weeks`;
  }
  if (seconds % DAY === 0) {
    const days = seconds / DAY;
    return days === 1 ? "every day" : `every ${days} days`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

/** "a week", "2 weeks", "a month": for "Next payment in a week." */
export function describeDuration(seconds: number): string {
  if (seconds % (30 * DAY) === 0) {
    const months = seconds / (30 * DAY);
    return months === 1 ? "a month" : `${months} months`;
  }
  if (seconds % WEEK === 0) {
    const weeks = seconds / WEEK;
    return weeks === 1 ? "a week" : `${weeks} weeks`;
  }
  const days = Math.max(1, Math.round(seconds / DAY));
  return days === 1 ? "a day" : `${days} days`;
}
