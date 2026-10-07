// Coach without AI: answers from the program's own rules and the user's
// on-chain facts. Pure (no React Native imports) so it is unit-tested with
// `npm test` (src/lib/coachRules.test.ts).
import { fmtSkr, fmtUsd, nextTier, skrBoost, tierOf } from "./credit";

export type Facts = {
  score: number;
  limit: number;
  available: number;
  activeDebt: number;
  onTime: number;
  late: number;
  plansOpened: number;
  plansRepaid: number;
  payments: number;
  streak: number;
  bestStreak: number;
  checkIns: number;
  checkinPoints: number;
  skrLocked: number;
  skrBalance: number;
  usdBalance: number;
  skrPrice: number; // micro-dollars
  upcoming: { merchant: string; amount: number; due: string }[];
  question?: { merchant: string; item: string; price: number; perInstallment: number }; // base units
};

/** The no-AI fallback: the same facts, turned into sentences by fixed rules. */
export function rulesSummary(f: Facts): string[] {
  const out: string[] = [];
  const next = nextTier(f.score);
  if (next) {
    const gap = next.min - f.score;
    const instalments = Math.ceil(gap / 12);
    out.push(
      `You're ${gap} points from ${next.band} (a $${next.limit} line). That's about ${instalments} on-time instalment${instalments === 1 ? "" : "s"}, or ${gap} daily check-ins.`,
    );
  } else out.push("You're in the top band. Keep paying on time to stay there.");
  if (f.late > 0) out.push(`${f.late} late instalment${f.late === 1 ? "" : "s"} cost you ${f.late * 30} points. Paying early always counts as on time.`);
  if (f.skrLocked === 0 && f.skrBalance > 0) {
    const boost = Math.floor(((f.skrBalance * f.skrPrice) / 1e6) * 0.5);
    out.push(`Locking your ${fmtSkr(f.skrBalance)} would add ${fmtUsd(boost)} to your limit today.`);
  }
  if (f.question) {
    const fits = f.question.price <= f.available;
    out.push(
      fits
        ? `${f.question.item} fits: 4 × ${fmtUsd(f.question.perInstallment)}, nothing due today, ${fmtUsd(f.available - f.question.price)} of your line left after.`
        : `${f.question.item} is over your available ${fmtUsd(f.available)}. Lock SKR or pay part now.`,
    );
  }
  if (f.checkinPoints < 60) out.push(`Clock in daily: +1 point a day (${60 - f.checkinPoints} left) and an SKR reward that grows with your streak.`);
  return out.slice(0, 4);
}

export type Intent = "afford" | "late" | "skr" | "tier" | "limit" | "streak" | "score" | "general";

/** Which rules answer a free-text question. Order matters: the most specific first. */
export function intentOf(question: string): Intent {
  const q = question.toLowerCase();
  if (/afford|\bfits?\b|can i (buy|pay for|get)|purchase|should i (buy|use pay in 4)/.test(q)) return "afford";
  if (/\blate\b|miss(ed)? (a )?payment|overdue|\bdefault|grace/.test(q)) return "late";
  if (/\bskr\b|\block|collateral|\bstake/.test(q)) return "skr";
  if (/next tier|fastest|\braise|increase|improve|\bgrow|higher|level up/.test(q)) return "tier";
  if (/\blimit\b|\bline\b|available|how much can i|spend/.test(q)) return "limit";
  if (/streak|clock|check.?in|daily|reward/.test(q)) return "streak";
  if (/score|points?\b|band|record/.test(q)) return "score";
  return "general";
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function rulesAnswer(question: string, f: Facts): string {
  const tier = tierOf(f.score);
  const next = nextTier(f.score);
  const base = tier.limit * 1_000_000;
  const boost = skrBoost(f.skrLocked, f.skrPrice, 5_000);
  const freeBoost = skrBoost(f.skrBalance, f.skrPrice, 5_000);
  switch (intentOf(question)) {
    case "limit": {
      const parts = [
        `Your score of ${f.score} puts you in ${tier.band}, which is a ${fmtUsd(base, 0)} line.`,
        f.skrLocked > 0
          ? `Your ${fmtSkr(f.skrLocked)} locked adds half its value, ${fmtUsd(boost)}, so your limit is ${fmtUsd(f.limit)}.`
          : `You have no SKR locked, so your limit is the line: ${fmtUsd(f.limit)}.`,
        f.activeDebt > 0
          ? `${fmtUsd(f.activeDebt)} of it is in use by open plans, leaving ${fmtUsd(f.available)} to spend.`
          : `Nothing is in use, so all ${fmtUsd(f.available)} is available.`,
      ];
      const raise: string[] = [];
      if (next) raise.push(`reaching ${next.min} (${next.band}) lifts the line to $${next.limit}`);
      if (freeBoost > 0) raise.push(`locking your free ${fmtSkr(f.skrBalance)} adds ${fmtUsd(freeBoost)} today`);
      if (raise.length) parts.push(`To raise it: ${raise.join("; ")}.`);
      return parts.join(" ");
    }
    case "tier": {
      if (!next) return "You're already in the top band ($1,000 line). Keep paying on time to stay there: a late instalment costs 30 points.";
      const gap = next.min - f.score;
      const inst = Math.ceil(gap / 12);
      const days = Math.max(0, 60 - f.checkinPoints);
      return [
        `You're ${plural(gap, "point")} from ${next.band}, which lifts your line from $${tier.limit} to $${next.limit}.`,
        `Fastest: open a Pay in 4 plan of $20 or more and pay instalments early. Each counts as on time (+12), so about ${plural(inst, "instalment")}, plus +10 when a plan is paid off.`,
        days > 0 ? `Clocking in adds 1 point a day (${days} of 60 left to earn).` : "You've used all 60 clock-in points; instalments are what move you now.",
      ].join(" ");
    }
    case "skr": {
      if (f.skrLocked === 0 && f.skrBalance === 0)
        return "You have no SKR yet. Clock in daily to earn it; once you have some, locking it adds half its dollar value to your Pay in 4 limit.";
      const lockLine =
        f.skrBalance > 0
          ? `Locking your free ${fmtSkr(f.skrBalance)} would add ${fmtUsd(freeBoost)} to your limit.`
          : `All your SKR is locked (${fmtSkr(f.skrLocked)}, adding ${fmtUsd(boost)}).`;
      return [
        lockLine,
        "Lock it if you want a bigger Pay in 4 limit now; it unlocks once it no longer backs what you owe.",
        "Keep it free if you'd rather pay instalments in SKR or hold it.",
      ].join(" ");
    }
    case "late": {
      const record = f.late > 0 ? ` You've had ${plural(f.late, "late instalment")} so far.` : " You have no late instalments.";
      return `An instalment paid more than 3 days after its due date costs 30 points, and a crank can collect it from your approved balance. Paying early always counts as on time (+12).${record}`;
    }
    case "afford": {
      if (!f.question)
        return `You have ${fmtUsd(f.available)} available for Pay in 4. Anything up to that fits: four weekly payments, nothing due today. Ask from a checkout and Coach checks that item.`;
      const fits = f.question.price <= f.available;
      return fits
        ? `${f.question.item} fits: 4 × ${fmtUsd(f.question.perInstallment)}, nothing due today, and ${fmtUsd(f.available - f.question.price)} of your line left after.`
        : `${f.question.item} is ${fmtUsd(f.question.price - f.available)} over your available ${fmtUsd(f.available)}. Lock SKR to raise your limit, or pay now.`;
    }
    case "streak": {
      return `Your streak is ${plural(f.streak, "day")} (best ${f.bestStreak}). Each clock-in pays SKR that grows with the streak up to 7×, and adds a score point (${Math.max(0, 60 - f.checkinPoints)} of 60 left). Miss a day and the streak starts again.`;
    }
    case "score": {
      return `Your score is ${f.score} (${tier.band}). Everyone starts at 520; you have ${plural(f.onTime, "on-time instalment")} (+12 each), ${plural(f.late, "late one")} (−30 each), ${plural(f.plansRepaid, "plan")} paid off (+10 each) and ${plural(f.checkinPoints, "clock-in point")}.`;
    }
    default:
      return rulesSummary(f).join("\n\n");
  }
}
