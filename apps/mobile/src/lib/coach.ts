// Polaris Coach. Claude reads the buyer's on-chain credit profile (nothing
// else) and answers in plain words: why the limit is what it is, what raises
// it, and whether a Pay in 4 plan fits. Two ways to reach Claude, neither of
// which ships a key in the APK:
//   1. EXPO_PUBLIC_COACH_URL: the small server in apps/coach (holds the key).
//   2. The user's own Anthropic API key, pasted in Me → Coach, kept in SecureStore.
// With neither, the app shows the rules-based summary below and says the AI is off.
import Anthropic from "@anthropic-ai/sdk";
import * as SecureStore from "expo-secure-store";
import { fmtSkr, fmtUsd, nextTier, tierOf, TIERS } from "./credit";

const KEY = "polaris.anthropic.key.v1";
export const COACH_URL = process.env.EXPO_PUBLIC_COACH_URL;
export const MODEL = "claude-opus-5-5";

export const getCoachKey = () => SecureStore.getItemAsync(KEY);
export const setCoachKey = (k: string | null) => (k ? SecureStore.setItemAsync(KEY, k.trim()) : SecureStore.deleteItemAsync(KEY));
export async function coachMode(): Promise<"server" | "key" | "off"> {
  if (COACH_URL) return "server";
  return (await getCoachKey()) ? "key" : "off";
}

export type { Facts } from "./coachRules";
export { rulesSummary, rulesAnswer } from "./coachRules";
import type { Facts } from "./coachRules";

export function factsText(f: Facts) {
  const lines = [
    `Score ${f.score} (band ${tierOf(f.score).band}); unsecured line ${fmtUsd(tierOf(f.score).limit * 1e6, 0)}.`,
    `Pay in 4 limit ${fmtUsd(f.limit)} (includes SKR collateral), owed now ${fmtUsd(f.activeDebt)}, available ${fmtUsd(f.available)}.`,
    `Wallet: ${fmtUsd(f.usdBalance)} pUSD, ${fmtSkr(f.skrBalance)} free, ${fmtSkr(f.skrLocked)} locked as collateral (SKR priced at ${fmtUsd(f.skrPrice, 3)}; counts at 50%).`,
    `Record: ${f.onTime} on-time instalments, ${f.late} late, ${f.plansRepaid}/${f.plansOpened} plans repaid, ${f.payments} Pay now payments.`,
    `Daily check-ins: streak ${f.streak} (best ${f.bestStreak}), ${f.checkIns} total, ${f.checkinPoints}/60 score points used.`,
    ...f.upcoming.map((u) => `Upcoming: ${u.merchant} ${fmtUsd(u.amount)} due ${u.due}.`),
  ];
  if (f.question)
    lines.push(
      `They are considering Pay in 4 at ${f.question.merchant}: ${f.question.item} for ${fmtUsd(f.question.price)} = 4 × ${fmtUsd(f.question.perInstallment)}.`,
    );
  return lines.join("\n");
}

const RULES = `Polaris scoring rules (enforced by the Solana program, do not invent others):
- Everyone starts at 520. On-time instalment +12 (plans of $20+), late instalment -30, plan repaid in full +10, Pay now of $5+ +2 (first 10), daily check-in +1 (first 60). Range 300-850.
- Unsecured line by score: ${TIERS.map((t) => `${t.min}+ → $${t.limit}`).join(", ")}.
- Locked SKR adds 50% of its dollar value to the limit; it cannot be unlocked while it backs debt.
- Paying early always counts as on time. Instalments are weekly; 10% APR pro-rated. Instalments can be paid in pUSD or in SKR.
- This is Solana devnet with test money (pUSD and a stand-in SKR).`;

const SYSTEM = `You are Polaris Coach inside a Solana mobile payments app with Pay in 4 credit.
Answer in at most 90 words, plain English, second person, no markdown headings, no lists longer than 3 items.
Use only the user's facts and the rules given. Be concrete with numbers (points, dollars, days). Never promise approval; the program decides.
Not financial advice; if asked about investing, say so briefly.
${RULES}`;

export async function askCoach(question: string, facts: Facts): Promise<string> {
  const content = `My Polaris profile:\n${factsText(facts)}\n\nQuestion: ${question}`;
  if (COACH_URL) {
    const r = await fetch(`${COACH_URL.replace(/\/$/, "")}/coach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: SYSTEM, content }),
    });
    if (!r.ok) throw new Error(`Coach server: ${r.status}`);
    return ((await r.json()) as { text: string }).text;
  }
  const apiKey = await getCoachKey();
  if (!apiKey) throw new Error("AI is off");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") return "The coach can't help with that one.";
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

