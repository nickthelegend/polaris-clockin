import type { ActivityItem, CreditLine, Plan } from "./data";
import { toNumber } from "./money";
import { movesBalance, signed } from "./view";

/**
 * Time series for the desktop charts (ref E's line and candles), rebuilt from
 * the same reads the phone screens use. A balance moves in steps, one per
 * payment; drawn as one smooth continuous curve, each step eases in over a
 * short while before it lands (a visible wiggle per payment, never a long
 * ramp), so the line always ends exactly on today's figure.
 */

export type Frame = "1h" | "24h" | "1w" | "1m";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FRAMES: Record<Frame, { span: number; points: number; candle: number; suffix: string; title: string; last: string }> = {
  "1h": { span: HOUR, points: 61, candle: 5 * MIN, suffix: "this hour", title: "the last hour", last: "Now" },
  "24h": { span: DAY, points: 97, candle: HOUR, suffix: "today", title: "the last 24 hours", last: "Now" },
  "1w": { span: 7 * DAY, points: 113, candle: 6 * HOUR, suffix: "this week", title: "the last 7 days", last: "Today" },
  "1m": { span: 30 * DAY, points: 121, candle: DAY, suffix: "this month", title: "the last 30 days", last: "Today" },
};

export type SeriesPoint = { t: number; value: number };
export type SeriesCandle = { t: number; o: number; h: number; l: number; c: number };

export type Series = {
  points: SeriesPoint[];
  /** When each move in the frame landed, oldest first (where the bubble can rest). */
  moves: number[];
  candles: SeriesCandle[];
  /** The figure at the start of the frame and now (exact, not smoothed). */
  start: number;
  end: number;
  /** The change over the frame in percent; null with nothing to compare against. */
  deltaPct: number | null;
  /** Every value zero: nothing to draw. */
  empty: boolean;
};

/** A step of `delta` dollars that lands at `at`. */
type Step = { at: number; delta: number };

/** 0 before `from`, 1 after `to`, a smooth S between (smootherstep). */
function ease(t: number, from: number, to: number): number {
  if (t <= from) return 0;
  if (t >= to) return 1;
  const x = (t - from) / (to - from);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** A figure that is `end` now and moved by `steps` on the way. */
function build(end: number, steps: Step[], frame: Frame, now: number): Series {
  const { span, points: count, candle } = FRAMES[frame];
  const from = now - span;
  // Each step eases in over about the average time between moves in the
  // frame, so the line runs on from one payment to the next (a wiggle per
  // payment, no long flat plateaus), but never more than an eighth of the
  // frame (one payment isn't smeared into a day-long slope) nor under 15
  // minutes.
  const moving = steps.filter((s) => s.at > from && s.at <= now).length;
  const ramp = Math.max(15 * MIN, Math.min(span / 8, span / (moving + 1)));

  const exact = (t: number) => end - steps.filter((s) => s.at > t).reduce((sum, s) => sum + s.delta, 0);
  const smooth = (t: number) => end - steps.reduce((sum, s) => sum + s.delta * (1 - ease(t, s.at - ramp, s.at)), 0);

  const points: SeriesPoint[] = Array.from({ length: count }, (_, i) => {
    const t = from + (i / (count - 1)) * span;
    return { t, value: Math.max(0, round2(smooth(t))) };
  });
  // The last point is today's figure to the cent.
  points[points.length - 1] = { t: now, value: round2(end) };

  const candles: SeriesCandle[] = [];
  for (let t0 = from; t0 < now - 1; t0 += candle) {
    const t1 = Math.min(now, t0 + candle);
    const o = exact(t0);
    const c = exact(t1);
    let h = Math.max(o, c);
    let l = Math.min(o, c);
    for (const s of steps) {
      if (s.at <= t0 || s.at > t1) continue;
      const v = exact(s.at);
      h = Math.max(h, v);
      l = Math.min(l, v);
    }
    candles.push({ t: t1, o: round2(o), h: round2(h), l: round2(l), c: round2(c) });
  }

  const start = exact(from);
  return {
    points,
    moves: steps.filter((s) => s.at > from && s.at <= now && s.delta !== 0).map((s) => s.at).sort((a, b) => a - b),
    candles,
    start: round2(start),
    end: round2(end),
    deltaPct: start > 0.005 ? ((end - start) / start) * 100 : null,
    empty: points.every((p) => p.value === 0),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The dollar account's balance over the frame. */
export function balanceSeries(balance: number, activity: ActivityItem[], frame: Frame, now: number): Series {
  const steps = activity.filter((a) => movesBalance(a) && a.at <= now).map((a) => ({ at: a.at, delta: signed(a) }));
  return build(balance, steps, frame, now);
}

/**
 * What the Pay later line can spend over the frame: a plan takes its total
 * when it opens and hands each instalment back as it is paid.
 */
export function creditSeries(credit: CreditLine, plans: Plan[], frame: Frame, now: number): Series {
  const steps: Step[] = [];
  for (const plan of plans) {
    const total = toNumber(plan.instalments.reduce((s, i) => s + i.amount, 0n));
    if (plan.openedAt <= now) steps.push({ at: plan.openedAt, delta: -total });
    for (const i of plan.instalments) if (i.paidAt !== null && i.paidAt <= now) steps.push({ at: i.paidAt, delta: toNumber(i.amount) });
  }
  return build(toNumber(credit.available), steps, frame, now);
}

/** Boost holds nothing yet: a flat zero. */
export function emptySeries(frame: Frame, now: number): Series {
  return build(0, [], frame, now);
}

/** Money out per bucket over the frame, as a smooth line (Insights). */
export function spendingSeries(activity: ActivityItem[], days: number, now: number): { points: SeriesPoint[]; total: number } {
  const span = days * DAY;
  const from = now - span;
  const out = activity.filter((a) => a.direction === "out" && movesBalance(a) && a.at > from && a.at <= now);
  const total = out.reduce((s, a) => s + toNumber(a.amount), 0);
  // Spent so far in the period: a running total that eases up at each payment.
  const ramp = span / 14;
  const count = Math.min(121, days * 8 + 1);
  const points = Array.from({ length: count }, (_, i) => {
    const t = from + (i / (count - 1)) * span;
    const v = out.reduce((s, a) => s + toNumber(a.amount) * ease(t, a.at - ramp, a.at), 0);
    return { t, value: round2(v) };
  });
  points[points.length - 1] = { t: now, value: round2(total) };
  return { points, total };
}

/** Money freed on the Pay later line over the last `days`: instalments paid back. */
export function creditFreed(plans: Plan[], days: number, now: number): number {
  return plans.reduce(
    (sum, p) => sum + p.instalments.filter((i) => i.paidAt !== null && now - i.paidAt <= days * DAY && i.paidAt <= now).reduce((s, i) => s + toNumber(i.amount), 0),
    0,
  );
}
