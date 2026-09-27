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
        body: JSON.stringify({ account: "0xacc0000000000000000000000000000000000002" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.dataMode, "fixture");
      assert.equal(body.decision.limit, "200000000");
      assert.equal(body.attest, true);

      // A three-day-old account is below the evidence floor: final, but nothing to report and no line.
      const thin = await (
        await fetch(`${url}/v1/underwrite`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: "0xacc0000000000000000000000000000000000001" }),
        })
      ).json();
      assert.equal(thin.final, true);
      assert.equal(thin.attest, false);
      assert.equal(thin.report, null);
      assert.equal(thin.decision.limit, "0");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses to start on a host that is not loopback without a token, instead of serving an open API", async () => {
    for (const HOST of ["0.0.0.0", "::", "192.168.1.20", "8.8.8.8"]) {
      await assert.rejects(startGateway({ PORT: "0", HOST, UNDERWRITING_MODE: "fixture" }), /refusing to serve .* without a token/, HOST);
      await assert.rejects(startGateway({ PORT: "0", HOST, UNDERWRITING_MODE: "fixture", UNDERWRITING_API_TOKEN: "   " }), /without a token/, `${HOST} with a blank token`);
    }
  });

  it("an empty HOST means loopback, not every interface", async () => {
    const { server, url } = await startGateway({ PORT: "0", HOST: "", UNDERWRITING_MODE: "fixture" });
    try {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const addr = server.address();
      assert.equal(typeof addr === "object" && addr ? addr.address : null, "127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("with a token, /v1/* answers only to it", async () => {
    const { server, url } = await startGateway({ PORT: "0", UNDERWRITING_MODE: "fixture", UNDERWRITING_API_TOKEN: "s3cret-token-for-tests" });
    try {
      const call = (auth?: string) =>
        fetch(`${url}/v1/explain`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
          body: JSON.stringify({ facts: { ...facts, stableBalance: "1240000000", observedAt: "1790424000" } }),
        });
      assert.equal((await call()).status, 401);
      assert.equal((await call("Bearer wrong")).status, 401);
      assert.equal((await call("Bearer s3cret-token-for-tests")).status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
