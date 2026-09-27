import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision.ts";
import { explainFacts } from "../src/core/reasons.ts";
import { scoreBreakdown } from "../src/core/score.ts";
import type { CreditDecision, Facts } from "../src/core/types.ts";
import { explainOnChainFacts } from "../src/core/underwrite.ts";
import { JARGON } from "./helpers.ts";

const f = (o: Partial<Facts> = {}): Facts => ({
  walletAgeDays: 0,
  txCount: 0,
  stableBalance: 0n,
  defiTenureDays: 0,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: false,
  observedAt: 0n,
  ...o,
});

/** Every string the buyer can see, except the one step the plan lets say "wallet". */
function visible(d: CreditDecision): string[] {
  return [
    d.headline,
    d.declineReason ?? "",
    d.payIn4.reason ?? "",
    ...d.reasons.flatMap((r) => [r.label, r.text]),
    ...d.nextSteps.filter((s) => s.id !== "link-history").map((s) => s.label),
  ].filter(Boolean);
}

describe("reasons in the buyer's words", () => {
  it('says "You\'ve used this account for 2 years · +48"', () => {
    const facts = f({ walletAgeDays: 730 });
    const lines = explainFacts(facts, scoreBreakdown(facts), {
      attribution: { walletAgeDays: { subject: "account", source: "zerion.transactions", status: "ok", lowerBound: false } } as never,
    });
    assert.equal(lines.find((l) => l.id === "age")?.text, "You've used this account for 2 years · +48");
  });

  it("credits a linked wallet's age to Nansen, and says over when a probe only proved a floor", () => {
    const facts = f({ walletAgeDays: 365 });
    const ctx = { linked: { address: "0x", used: true, excludedFor: null, riskLabel: null } };
    const exact = explainFacts(facts, scoreBreakdown(facts), {
      ...ctx,
      attribution: { walletAgeDays: { subject: "linked", source: "nansen.first-funder", status: "ok", lowerBound: false } } as never,
    });
    const probed = explainFacts(facts, scoreBreakdown(facts), {
      ...ctx,
      attribution: { walletAgeDays: { subject: "linked", source: "zerion.probe", status: "fallback", lowerBound: true } } as never,
    });
    assert.equal(exact[0]?.text, "You've used your linked account for a year · +24");
    assert.equal(exact[0]?.provider, "nansen");
    assert.equal(probed[0]?.text, "You've used your linked account for over a year · +24");
    assert.equal(probed[0]?.provider, "zerion");
  });

  it("names the exchange and the points it earned", () => {
    const facts = f({ exchangeFunded: true });
    const lines = explainFacts(facts, scoreBreakdown(facts), { exchange: "Coinbase" });
    const line = lines.find((l) => l.id === "exchange");
    assert.equal(line?.text, "First topped up from Coinbase, a major exchange · +10");
    assert.equal(line?.provider, "nansen");
  });

  it("explains penalties plainly", () => {
    const facts = f({ priorLiquidations: 1, relatedWallets: 9 });
    const lines = explainFacts(facts, scoreBreakdown(facts), {});
    assert.equal(lines.find((l) => l.id === "liquidations")?.text, "A past loan elsewhere was closed by the lender · −75");
    assert.equal(lines.find((l) => l.id === "cluster")?.text, "Set up from the same source as 9 other accounts · −12");
  });

  it("the lines add up to the score, from the 520 floor", () => {
    const rand = (() => {
      let s = 7;
      return () => ((s = (s * 48271) % 2147483647) / 2147483647);
    })();
    for (let i = 0; i < 500; i++) {
      const facts = f({
        walletAgeDays: Math.floor(rand() * 1500),
        txCount: Math.floor(rand() * 2000),
        stableBalance: BigInt(Math.floor(rand() * 8_000)) * 1_000_000n,
        defiTenureDays: Math.floor(rand() * 1200),
        priorLiquidations: rand() < 0.1 ? 1 : 0,
        relatedWallets: Math.floor(rand() * 20),
        exchangeFunded: rand() < 0.4,
      });
      const b = scoreBreakdown(facts);
      const sum = explainFacts(facts, b, { linked: { address: "0x", used: true, excludedFor: null, riskLabel: null } }).reduce((a, l) => a + l.points, 0);
      assert.equal(b.floor + sum, b.raw);
    }
  });

  it("orders what helped first, then what cost, then the rest", () => {
    const facts = f({ walletAgeDays: 400, stableBalance: 900_000_000n, priorLiquidations: 1 });
    const kinds = explainFacts(facts, scoreBreakdown(facts), {}).map((l) => l.kind);
    const order = { plus: 0, minus: 1, neutral: 2, info: 3 } as const;
    assert.deepEqual(kinds, [...kinds].sort((a, b) => order[a] - order[b]));
  });

  it("never uses a word from the plan's 'Words the buyer never sees' table", () => {
    const cases: Array<Partial<Facts>> = [
      {},
      { walletAgeDays: 1210, txCount: 902, stableBalance: 4_237_850_000n, defiTenureDays: 730, exchangeFunded: true },
      { priorLiquidations: 2, walletAgeDays: 800 },
      { relatedWallets: 30 },
      { relatedWallets: 8, stableBalance: 50_000_000n },
    ];
    for (const c of cases) {
      for (const purchase of [null, 200_000_000n, 5_000_000_000n]) {
        const { decision } = explainOnChainFacts(f(c), { purchase });
        for (const text of visible(decision)) assert.doesNotMatch(text, JARGON, text);
        const linkedCopy = decide({ score: 520, declined: false, hasLinked: false }).nextSteps.find((s) => s.id === "link-history");
        assert.equal(linkedCopy?.label, "Raise your limit: confirm with the wallet you already use.", "the plan's one allowed exception");
      }
    }
  });

  it("a thin file's copy keeps to the same words, for every gap and every pending state", () => {
    const gapSets = [
      [{ fact: "walletAgeDays" as const, have: 0, need: 30 }, { fact: "txCount" as const, have: 0, need: 5 }],
      [{ fact: "walletAgeDays" as const, have: 29, need: 30 }],
      [{ fact: "txCount" as const, have: 4, need: 5 }],
    ];
    for (const thinFile of gapSets) {
      for (const pending of [null, "checks", "ownership"] as const) {
        for (const purchase of [null, 200_000_000n]) {
          for (const collateralBoost of [0n, 300_000_000n]) {
            const d = decide({ score: 520, declined: false, thinFile, pending, purchase, collateralBoost, hasLinked: pending === "ownership" });
            for (const text of visible(d)) assert.doesNotMatch(text, JARGON, text);
            assert.equal(d.limit, 0n);
          }
        }
      }
    }
    const step = decide({ score: 520, declined: false, thinFile: gapSets[0] }).nextSteps.find((s) => s.id === "link-history");
    assert.equal(step?.label, "Open a line now: confirm with the wallet you already use.", "the Bring your history step, the one place 'wallet' is allowed");
  });
});
