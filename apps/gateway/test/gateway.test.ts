import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseLimit, decisionFor, explain, formatUnits, scoreFrom } from "../src/score.ts";
import { startGateway } from "../src/server.ts";

const facts = {
  walletAgeDays: 730,
  txCount: 300,
  stableBalance: 1_240_000_000n,
  defiTenureDays: 0,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: true,
  observedAt: 1_790_424_000n,
};

describe("score explanations", () => {
  it("explains facts in the buyer's words, with points", () => {
    assert.deepEqual(explain(facts), [
      "You've used this account for 2 years · +48",
      "You've made 300 payments and transfers · +12",
      "You keep $1,240 on hand · +12",
      "First topped up from a major exchange · +10",
    ]);
  });

  it("scores with ScoreManager's formula and tiers", () => {
    const band = scoreFrom(facts);
    assert.equal(band.score, 520 + 48 + 12 + 12 + 10);
    assert.equal(band.limit, 500_000_000n);
    assert.equal(baseLimit(670), 1_000_000_000n);
    assert.equal(formatUnits(1_240_000_000n), "$1,240");
  });

  it("gives the whole decision for facts on chain", () => {
    const d = decisionFor(facts, { purchase: 400_000_000n });
    assert.equal(d.payIn4.allowed, true);
    assert.equal(d.limit, 500_000_000n);
  });
});

describe("the gateway", () => {
  it("serves /health and underwriting from fixtures when no key is set", async () => {
    const { server, url } = await startGateway({ PORT: "0", UNDERWRITING_MODE: "fixture" });
    try {
      const health = await (await fetch(`${url}/health`)).json();
      assert.equal(health.modes.nansen, "fixture");
      const res = await fetch(`${url}/v1/underwrite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "0xacc0000000000000000000000000000000000001" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.dataMode, "fixture");
      assert.equal(body.decision.limit, "200000000");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
