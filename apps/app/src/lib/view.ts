import { type ActivityItem, type CreditLine, dueAt, type Plan, type Subscription } from "./data";
import { shortDate, time } from "./dates";
import { type Micros, toNumber, usd } from "./money";

/**
 * Presentation helpers: figures the screens show, derived from the data
 * layer's reads. Nothing here fetches or writes.
 */

const MS_DAY = 86_400_000;

/** Dollars as a number, for the @polaris/ui components (which take dollars). */
export const n = (micros: Micros): number => toNumber(micros);

/**
 * Whether a row moved money in or out of the dollar account. Opening a Pay in 4
 * plan doesn't: the merchant is paid from the credit pool, and the buyer's
 * money moves later, one instalment at a time.
 */
export function movesBalance(item: ActivityItem): boolean {
  return item.kind !== "plan-opened";
}

/** Signed dollars for a row: negative is money out. */
export function signed(item: ActivityItem): number {
  return item.direction === "out" ? -toNumber(item.amount) : toNumber(item.amount);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "9:10", "Yesterday", "Sep 24": under a row's title. */
export function when(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / MS_DAY);
  if (days === 0) return time(ts);
  if (days === 1) return "Yesterday";
  return shortDate(ts);
}

/* ── Payment details ─────────────────────────────────────────────────────── */

export const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  payment: "Paid in full",
  instalment: "Pay in 4 instalment",
  "plan-opened": "Pay in 4",
  subscription: "Subscription",
  "sent-link": "Sent by link",
  sent: "Sent",
  received: "Received",
  claimed: "Received by link",
  refund: "Returned",
  added: "Added money",
};

/** A send link nobody has claimed yet: the money is held, and the sender can take it back. */
export const isOpenLink = (item: ActivityItem) => item.kind === "sent-link" && item.detail === "Waiting to be claimed";

export function statusOf(item: ActivityItem): string {
  if (item.status !== "settled") return "Processing";
  if (isOpenLink(item)) return "Waiting";
  // Taken back by its sender: the money is in a "Link cancelled" row of its own.
  if (item.kind === "sent-link" && item.detail === "Cancelled") return "Cancelled";
  if (item.kind === "plan-opened") return "Plan open";
  return "Complete";
}

/** The small line under a row's amount (ref A's sub-amount). */
export function subAmount(item: ActivityItem): string {
  const part = item.detail.match(/(\d+) of (\d+)/);
  switch (item.kind) {
    case "payment":
      return "Paid in full";
    case "instalment":
      return part ? `Pay in 4 · ${part[1]} of ${part[2]}` : "Pay in 4";
    case "plan-opened":
      return "Pay in 4 · nothing today";
    case "subscription":
      return "Subscription";
    case "sent-link":
      return item.detail === "Waiting to be claimed" ? "Link · waiting" : "By link";
    case "sent":
      return "Sent";
    case "received":
      return "Received";
    case "claimed":
      return "Link claimed";
    case "refund":
      return "Returned";
    case "added":
      return "Added";
  }
}

/** What the balance did over the last `days` days, in percent. */
export function balanceChange(balance: Micros, activity: ActivityItem[], days = 1, now = Date.now()): number {
  let net = 0n;
  for (const a of activity) {
    if (now - a.at > days * MS_DAY || !movesBalance(a)) continue;
    net += a.direction === "in" ? a.amount : -a.amount;
  }
  const before = balance - net;
  if (before <= 0n) return 0;
  return (toNumber(net) / toNumber(before)) * 100;
}

/* ── Spending ────────────────────────────────────────────────────────────── */

export const SPENDING_CATEGORIES = ["Food", "Shopping", "Travel", "Bills", "Subscriptions", "Other"] as const;
export type SpendingCategory = (typeof SPENDING_CATEGORIES)[number];

const MERCHANT_CATEGORY: Record<string, SpendingCategory> = {
  Café: "Food",
  Restaurant: "Food",
  Groceries: "Food",
  Books: "Shopping",
  Rides: "Travel",
  "Phone plan": "Bills",
  "Audio gear": "Shopping",
  "Design studio": "Shopping",
  "Design software": "Shopping",
  Travel: "Travel",
  Fitness: "Bills",
};

export type Period = "week" | "month" | "all";

export const PERIOD_LABEL: Record<Period, string> = { week: "This week", month: "This month", all: "All time" };

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, all: 3650 };

export function inPeriod(item: ActivityItem, period: Period, now = Date.now()): boolean {
  return now - item.at <= PERIOD_DAYS[period] * MS_DAY;
}

/** Spending by category, in percent of the period's spending. */
export function spendingByCategory(
  activity: ActivityItem[],
  categoryOf: (merchantName: string) => string | undefined,
  period: Period,
): { label: SpendingCategory; value: number; amount: number }[] {
  const totals = new Map<SpendingCategory, number>();
  for (const a of activity) {
    if (a.direction !== "out" || !movesBalance(a) || !inPeriod(a, period)) continue;
    let category: SpendingCategory = "Other";
    if (a.kind === "subscription") category = "Subscriptions";
    else if (a.counterparty.kind === "merchant") category = MERCHANT_CATEGORY[a.counterparty.category ?? categoryOf(a.counterparty.name) ?? ""] ?? "Other";
    totals.set(category, (totals.get(category) ?? 0) + toNumber(a.amount));
  }
  const sum = [...totals.values()].reduce((s, v) => s + v, 0);
  if (sum === 0) return [];
  return SPENDING_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0)
    .map((label) => ({ label, amount: totals.get(label)!, value: (totals.get(label)! / sum) * 100 }))
    .sort((a, b) => b.value - a.value);
}

/** Money out per day over the last `days` days, oldest first. */
export function dailySpending(activity: ActivityItem[], days: number, now = Date.now()): number[] {
  const today = startOfDay(now);
  const out = Array.from({ length: days }, () => 0);
  for (const a of activity) {
    if (a.direction !== "out" || !movesBalance(a)) continue;
    const i = days - 1 - Math.round((today - startOfDay(a.at)) / MS_DAY);
    if (i >= 0 && i < days) out[i]! += toNumber(a.amount);
  }
  return out;
}

export function spentBetween(activity: ActivityItem[], fromDaysAgo: number, toDaysAgo: number, now = Date.now()): number {
  return activity
    .filter((a) => a.direction === "out" && movesBalance(a) && now - a.at <= fromDaysAgo * MS_DAY && now - a.at > toDaysAgo * MS_DAY)
    .reduce((s, a) => s + toNumber(a.amount), 0);
}

/* ── Credit score history ────────────────────────────────────────────────── */

/**
 * The score day by day, rebuilt from the facts behind it: the account's age
 * and every instalment paid on time move it the same way the underwriter
 * does (see the data layer's `reasons`). Ends on today's score.
 */
export function scoreHistory(credit: CreditLine, plans: Plan[], memberSince: number, days: number, now = Date.now()): number[] {
  const paid = plans.flatMap((p) => p.instalments.map((i) => i.paidAt).filter((t): t is number => t !== null));
  const perInstalment = credit.reasons[0]?.points && paid.length ? credit.reasons[0].points / paid.length : 12;
  const today = startOfDay(now);
  const series: number[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const at = today - d * MS_DAY + MS_DAY - 1;
    const paidBy = paid.filter((t) => t <= at).length;
    const ageShare = Math.min(1, Math.max(0, (at - memberSince) / (now - memberSince || 1)));
    // Everything the score counts today, minus what hadn't happened yet on that day.
    const missing = (paid.length - paidBy) * perInstalment + (1 - ageShare) * 6;
    series.push(Math.round(credit.score - missing));
  }
  return series;
}

/** Week-by-week candles from a daily series (open, high, low, close). */
export function weeklyCandles(daily: number[], endsAt = Date.now()): { t: number; o: number; h: number; l: number; c: number }[] {
  const candles = [];
  for (let end = daily.length; end > 0; end -= 7) {
    const week = daily.slice(Math.max(0, end - 7), end);
    const prev = daily[Math.max(0, end - 8)] ?? week[0]!;
    candles.unshift({
      t: endsAt - (daily.length - end) * MS_DAY,
      o: prev,
      h: Math.max(prev, ...week),
      l: Math.min(prev, ...week),
      c: week[week.length - 1]!,
    });
  }
  return candles;
}

/* ── Plans ───────────────────────────────────────────────────────────────── */

export function planProgress(plan: Plan): { done: number; total: number; left: Micros; next: Plan["instalments"][number] | null } {
  const done = plan.instalments.filter((i) => i.paidAt !== null).length;
  const left = plan.instalments.filter((i) => i.paidAt === null).reduce((s, i) => s + i.amount, 0n);
  return { done, total: plan.instalments.length, left, next: plan.instalments.find((i) => i.paidAt === null) ?? null };
}

/* ── Notifications ───────────────────────────────────────────────────────── */

export type Notice = {
  id: string;
  at: number;
  kind: "due" | "in" | "claimed" | "renews" | "plan";
  title: string;
  detail: string;
  href: string;
};

/** What the bell shows: payments coming up, money that arrived, links claimed. */
export function notices(
  activity: ActivityItem[],
  credit: CreditLine | undefined,
  { plans, subscriptions }: { plans: Plan[]; subscriptions: Subscription[] },
  now = Date.now(),
): Notice[] {
  const list: Notice[] = [];
  if (credit?.nextPayment && credit.nextPayment.dueAt - now <= 7 * MS_DAY) {
    const p = credit.nextPayment;
    const days = Math.round((p.dueAt - now) / MS_DAY);
    list.push({
      id: `due-${p.planId}-${p.dueAt}`,
      // When it came into the week ahead: stable, so the bell doesn't ring on every read.
      at: p.dueAt - 7 * MS_DAY,
      kind: "due",
      title: `${usd(p.amount)} to ${p.merchant} ${days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`,
      detail: "Your next Pay in 4 payment. Pay early any time.",
      href: `/plans/${p.planId}`,
    });
  }
  for (const s of subscriptions) {
    if (s.status !== "active" || s.nextChargeAt - now > 14 * MS_DAY || s.nextChargeAt < now) continue;
    list.push({
      id: `renew-${s.id}-${s.nextChargeAt}`,
      at: s.nextChargeAt - 14 * MS_DAY,
      kind: "renews",
      title: `${s.merchant.name} renews on ${shortDate(s.nextChargeAt)}`,
      detail: `${s.name}, ${usd(s.price)}`,
      href: "/insights?view=plans",
    });
  }
  for (const a of activity) {
    if (now - a.at > 14 * MS_DAY) continue;
    if (a.kind === "received" || a.kind === "claimed" || a.kind === "added" || a.kind === "refund") {
      list.push({
        id: `in-${a.id}`,
        at: a.at,
        kind: "in",
        title:
          a.kind === "added"
            ? `${usd(a.amount)} added`
            : a.kind === "refund"
              ? `${usd(a.amount)} back in your account`
              : a.kind === "claimed" && a.counterparty.kind === "polaris"
                ? `${usd(a.amount)} received by link`
                : `${usd(a.amount)} from ${a.title}`,
        detail: a.kind === "claimed" ? "You claimed their link" : a.detail,
        href: `/activity/${a.id}`,
      });
    }
    if (a.kind === "sent-link" && a.detail === "Claimed") {
      list.push({ id: `claimed-${a.id}`, at: a.settledAt ?? a.at, kind: "claimed", title: "Your link was claimed", detail: `${usd(a.amount)} arrived`, href: `/activity/${a.id}` });
    }
    if (a.kind === "plan-opened") {
      const plan = plans.find((p) => p.id === a.planId);
      const first = plan ? plan.instalments[0]?.dueAt ?? dueAt(plan.openedAt, plan.interval, 0) : null;
      list.push({
        id: `plan-${a.id}`,
        at: a.at,
        kind: "plan",
        title: `Pay in 4 with ${a.title}`,
        detail: first ? `First payment ${shortDate(first)}` : "Nothing to pay today",
        href: plan ? `/plans/${plan.id}` : `/activity/${a.id}`,
      });
    }
  }
  return list.sort((a, b) => b.at - a.at);
}
