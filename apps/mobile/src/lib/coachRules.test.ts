// npm test: every suggested Coach question gets its own rules-based answer.
import test from "node:test";
import assert from "node:assert/strict";
import { intentOf, rulesAnswer, rulesSummary, type Facts } from "./coachRules";

const ONE = 1_000_000;
// The state from the scripted run: score 533, 3,000 SKR locked, a $64.49 plan with $48.37 left.
const facts: Facts = {
  score: 533,
  limit: 125 * ONE,
  available: 76.63 * ONE,
  activeDebt: 48.37 * ONE,
  onTime: 1,
  late: 0,
  plansOpened: 1,
  plansRepaid: 0,
  payments: 0,
  streak: 1,
  bestStreak: 1,
  checkIns: 1,
  checkinPoints: 1,
  skrLocked: 3_000 * ONE,
  skrBalance: 1_025 * ONE,
  usdBalance: 233.88 * ONE,
  skrPrice: 50_000,
  upcoming: [],
};

const SUGGESTED = {
  "How do I reach the next tier fastest?": "tier",
  "Why is my limit what it is?": "limit",
  "Should I lock SKR or keep it?": "skr",
  "What happens if I pay late?": "late",
} as const;

test("each suggested question routes to its own intent", () => {
  for (const [q, intent] of Object.entries(SUGGESTED)) assert.equal(intentOf(q), intent, q);
});

test("each suggested question gets a different answer", () => {
  const answers = Object.keys(SUGGESTED).map((q) => rulesAnswer(q, facts));
  assert.equal(new Set(answers).size, answers.length);
  for (const a of answers) assert.notEqual(a, rulesSummary(facts).join("\n\n"));
});

test("the limit answer explains base line + SKR collateral - in use, and what raises it", () => {
  const a = rulesAnswer("Why is my limit what it is?", facts);
  assert.match(a, /score of 533/);
  assert.match(a, /\$50 line/); // Starter tier
  assert.match(a, /3,000 SKR locked adds half its value, \$75\.00/);
  assert.match(a, /limit is \$125\.00/);
  assert.match(a, /\$48\.37 of it is in use/);
  assert.match(a, /\$76\.63 to spend/);
  assert.match(a, /reaching 560 \(Fair\) lifts the line to \$150/);
  assert.match(a, /locking your free 1,025 SKR adds \$25\.63/);
  assert.doesNotMatch(a, /points from Fair/);
});

test("the tier answer gives the gap and the fastest route", () => {
  const a = rulesAnswer("How do I reach the next tier fastest?", facts);
  assert.match(a, /27 points from Fair/);
  assert.match(a, /about 3 instalments/);
  assert.match(a, /59 of 60 left/);
});

test("the SKR answer compares locking with keeping", () => {
  const a = rulesAnswer("Should I lock SKR or keep it?", facts);
  assert.match(a, /would add \$25\.63/);
  assert.match(a, /Keep it free/);
});

test("the late answer states the penalty and the grace", () => {
  const a = rulesAnswer("What happens if I pay late?", facts);
  assert.match(a, /costs 30 points/);
  assert.match(a, /no late instalments/);
});

test("free-text keywords route without collisions", () => {
  const cases: [string, string][] = [
    ["Can I afford these headphones?", "afford"],
    ["Does this fit my budget?", "afford"],
    ["I missed a payment, what now?", "late"],
    ["what does collateral do", "skr"],
    ["How can I raise my limit?", "tier"],
    ["how much can I spend", "limit"],
    ["What's my available line?", "limit"],
    ["How does the streak work?", "streak"],
    ["Explain my score", "score"],
    ["hello", "general"],
  ];
  for (const [q, intent] of cases) assert.equal(intentOf(q), intent, q);
});

test("affordability uses the checkout question when there is one", () => {
  const fits = rulesAnswer("Can I afford this on Pay in 4?", {
    ...facts,
    question: { merchant: "Kora Rail", item: "Lisbon → Porto", price: 64 * ONE, perInstallment: 16.12 * ONE },
  });
  assert.match(fits, /fits: 4 × \$16\.12/);
  const over = rulesAnswer("Can I afford this on Pay in 4?", {
    ...facts,
    question: { merchant: "Lumen Audio", item: "Studio headphones", price: 240 * ONE, perInstallment: 60 * ONE },
  });
  assert.match(over, /\$163\.37 over your available \$76\.63/);
});

test("top band and no-SKR edge cases", () => {
  assert.match(rulesAnswer("How do I reach the next tier fastest?", { ...facts, score: 800 }), /top band/);
  assert.match(rulesAnswer("Should I lock SKR or keep it?", { ...facts, skrLocked: 0, skrBalance: 0 }), /no SKR yet/);
  assert.match(rulesAnswer("Why is my limit what it is?", { ...facts, skrLocked: 0, activeDebt: 0, limit: 50 * ONE, available: 50 * ONE }), /no SKR locked/);
});
