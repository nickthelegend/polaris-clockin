import { merchantName } from "../chain/polaris";
import { PARAMS } from "./config";
import { dueAt, fmtDue, installmentAmount } from "./credit";
import type { Facts } from "./coach";

/** The coach's input: only what the chain says about this wallet. */
export function buildFacts(a: {
  score: number;
  limit: number;
  available: number;
  usd: number;
  skr: number;
  profile: any;
  config: any;
  plans: any[];
}): Facts {
  const p = a.profile;
  const n = (x: any) => (x?.toNumber ? x.toNumber() : Number(x ?? 0));
  return {
    score: a.score,
    limit: a.limit,
    available: a.available,
    activeDebt: n(p?.activeDebt),
    onTime: p?.onTime ?? 0,
    late: p?.late ?? 0,
    plansOpened: p?.plansOpened ?? 0,
    plansRepaid: p?.plansRepaid ?? 0,
    payments: p?.payments ?? 0,
    streak: p?.streak ?? 0,
    bestStreak: p?.bestStreak ?? 0,
    checkIns: p?.checkIns ?? 0,
    checkinPoints: p?.checkinPoints ?? 0,
    skrLocked: n(p?.skrLocked),
    skrBalance: a.skr,
    usdBalance: a.usd,
    skrPrice: n(a.config?.skrPriceMicros) || PARAMS.skrPriceMicros,
    upcoming: a.plans
      .filter((pl) => pl.paid < pl.installments)
      .slice(0, 3)
      .map((pl) => ({
        merchant: merchantName(pl.merchant),
        amount: installmentAmount(n(pl.totalOwed), n(pl.repaid), pl.paid),
        due: fmtDue(dueAt(n(pl.startedAt), n(pl.intervalSecs), pl.paid)),
      })),
  };
}
