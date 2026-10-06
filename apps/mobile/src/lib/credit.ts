// Mirror of packages/solana/programs/polaris/src/math.rs, so the app shows
// exactly what the program will enforce. Amounts in base units (6 decimals).
export const ONE = 1_000_000;
export const INSTALLMENTS = 4;
export const STARTING_SCORE = 520;
export const CHECKIN_SCORE_CAP = 60;
export const SCORE = { onTime: 12, late: 30, planDone: 10, payment: 2 } as const;

export const TIERS = [
  { min: 740, limit: 1_000, band: "Excellent" },
  { min: 680, limit: 600, band: "Very good" },
  { min: 620, limit: 300, band: "Good" },
  { min: 560, limit: 150, band: "Fair" },
  { min: 0, limit: 50, band: "Starter" },
];

export function tierOf(score: number) {
  return TIERS.find((t) => score >= t.min)!;
}
export function nextTier(score: number) {
  const i = TIERS.findIndex((t) => score >= t.min);
  return i > 0 ? TIERS[i - 1] : null;
}
export const baseLimit = (score: number) => tierOf(score).limit * ONE;

export function skrBoost(skrLocked: number, priceMicros: number, bps: number) {
  return Math.floor((Math.floor((skrLocked * priceMicros) / ONE) * bps) / 10_000);
}
export function creditLimit(score: number, skrLocked: number, priceMicros: number, bps: number) {
  return baseLimit(score) + skrBoost(skrLocked, priceMicros, bps);
}
export function planTotal(principal: number, intervalSecs: number) {
  const term = BigInt(intervalSecs) * BigInt(INSTALLMENTS);
  const interest = (BigInt(principal) * 1000n * term) / (10_000n * 31_536_000n);
  return principal + Number(interest);
}
export function installmentAmount(total: number, repaid: number, paid: number) {
  return paid + 1 >= INSTALLMENTS ? total - repaid : Math.floor(total / INSTALLMENTS);
}
export const dueAt = (startedAt: number, interval: number, paid: number) => startedAt + interval * (paid + 1);
export function skrForUsd(usd: number, priceMicros: number) {
  return Math.ceil((usd * ONE) / priceMicros);
}
export const checkinReward = (base: number, streak: number) => base * Math.min(Math.max(streak, 1), 7);
export const today = (nowSecs = Date.now() / 1000) => Math.floor(nowSecs / 86_400);

export const usd = (base: number) => base / ONE;
export const fmtUsd = (base: number, digits = 2) =>
  "$" + (base / ONE).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtSkr = (base: number) =>
  (base / ONE).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " SKR";

export function fmtDue(ts: number) {
  const d = new Date(ts * 1000);
  const days = Math.round((ts * 1000 - Date.now()) / 86_400_000);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (days < 0) return `${date} · overdue`;
  if (days === 0) return `${date} · today`;
  return `${date} · in ${days} day${days === 1 ? "" : "s"}`;
}
