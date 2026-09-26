import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeUnderwriteReport } from "../src/core/abi.ts";
import { DAY_SECONDS, FACTS_VERSION, U16_MAX, U32_MAX, U64_MAX } from "../src/core/constants.ts";
import { accountRules, evidence } from "../src/core/evidence.ts";
import { deriveFacts } from "../src/core/facts.ts";
import type { Address, Funder, SubjectEvidence } from "../src/core/types.ts";
import { underwrite } from "../src/core/underwrite.ts";

const NOW = 1_790_424_000;
const ACCOUNT = "0xacc0000000000000000000000000000000000001" as Address;
const WALLET = "0xb0b0000000000000000000000000000000000001" as Address;
const days = (n: number) => NOW - n * DAY_SECONDS;

function account(o: Partial<SubjectEvidence> = {}): SubjectEvidence {
  return {
    address: ACCOUNT,
    role: "account",
    firstSeenAt: evidence.ok<number | null>(days(3), "zerion.transactions"),
    sentCount: evidence.ok(2, "zerion.transactions"),
    stableBalance: evidence.ok(37_600_000, "rpc.balance"),
    ...accountRules(),
    ...o,
  };
}

const coinbase: Funder = { address: "0xc0ba5e0000000000000000000000000000000002", name: "Coinbase: Hot Wallet 2", chain: "ethereum", fundedAt: days(1210) };
const peer: Funder = { address: "0xfeed000000000000000000000000000000000002", name: null, chain: "base", fundedAt: days(200) };

function linked(o: Partial<SubjectEvidence> = {}, funder: Funder | null = peer): SubjectEvidence {
  return {
    address: WALLET,
    role: "linked",
    firstSeenAt: evidence.ok<number | null>(funder?.fundedAt ?? days(400), "nansen.first-funder"),
    sentCount: evidence.ok(900, "rpc.nonce"),
    stableBalance: evidence.ok(4_200_250_000, "zerion.positions"),
    defiSince: evidence.ok<number | null>(days(730), "zerion.probe"),
    liquidations: evidence.ok(0, "etherscan.logs"),
    funder: evidence.ok<Funder | null>(funder, "nansen.first-funder"),
    relatedWallets: evidence.ok(0, "nansen.related-wallets"),
    riskLabel: evidence.ok<string | null>(null, "nansen.first-funder"),
    ...o,
  };
}

describe("deriveFacts v1", () => {
  it("scores the account alone on its own history", () => {
    const d = deriveFacts({ account: account(), observedAt: NOW });
    assert.deepEqual(d.facts, {
      walletAgeDays: 3,
      txCount: 2,
      stableBalance: 37_600_000n,
      defiTenureDays: 0,
      priorLiquidations: 0,
      relatedWallets: 0,
      exchangeFunded: false,
      observedAt: BigInt(NOW),
    });
    assert.equal(d.final, true);
    assert.equal(d.version, FACTS_VERSION);
    assert.equal(d.linked, null);
  });

  it("merges a linked wallet: the older age, summed activity and dollars, its tenure and funding", () => {
    const d = deriveFacts({ account: account(), linked: linked({}, coinbase), observedAt: NOW });
    assert.equal(d.facts.walletAgeDays, 1210);
    assert.equal(d.facts.txCount, 902);
    assert.equal(d.facts.stableBalance, 4_237_850_000n);
    assert.equal(d.facts.defiTenureDays, 730);
    assert.equal(d.facts.exchangeFunded, true);
    assert.equal(d.exchange, "Coinbase");
    assert.equal(d.attribution.walletAgeDays.subject, "linked");
    assert.equal(d.attribution.walletAgeDays.source, "nansen.first-funder");
    assert.equal(d.attribution.defiTenureDays.lowerBound, true, "a probe proves a floor, not an exact age");
    assert.equal(d.linked?.used, true);
  });

  it("counts a cluster of accounts set up by one funder", () => {
    const d = deriveFacts({ account: account(), linked: linked({ relatedWallets: evidence.ok(12, "nansen.related-wallets") }), observedAt: NOW });
    assert.equal(d.facts.relatedWallets, 12);
    assert.equal(d.infrastructureFunder, false);
  });

  it("ignores the cluster when the funder was an exchange", () => {
    const d = deriveFacts({ account: account(), linked: linked({ relatedWallets: evidence.ok(40, "nansen.related-wallets") }, coinbase), observedAt: NOW });
    assert.equal(d.facts.relatedWallets, 0);
    assert.equal(d.facts.exchangeFunded, true);
  });

  it("treats a funder tied to 60 or more wallets as infrastructure, not a cluster", () => {
    const at59 = deriveFacts({ account: account(), linked: linked({ relatedWallets: evidence.ok(59, "nansen.related-wallets") }), observedAt: NOW });
    const at60 = deriveFacts({ account: account(), linked: linked({ relatedWallets: evidence.ok(60, "nansen.related-wallets") }), observedAt: NOW });
    assert.equal(at59.facts.relatedWallets, 59);
    assert.equal(at60.facts.relatedWallets, 0);
    assert.equal(at60.infrastructureFunder, true);
  });

  it("does not count a linked wallet with a high-risk label, and says why", () => {
    const d = deriveFacts({
      account: account(),
      linked: linked({ riskLabel: evidence.ok<string | null>("Tornado Cash: Router", "nansen.first-funder") }),
      observedAt: NOW,
    });
    assert.equal(d.linked?.used, false);
    assert.equal(d.linked?.excludedFor, "risk-label");
    assert.equal(d.facts.walletAgeDays, 3, "the account is underwritten on its own");
    assert.equal(d.facts.stableBalance, 37_600_000n);
    assert.equal(d.final, true, "a known risk is a known fact, not a missing one");
  });

  it("leaves a linked wallet out, and is not final, when a risk check could not run", () => {
    for (const field of ["liquidations", "relatedWallets", "riskLabel", "funder"] as const) {
      const d = deriveFacts({
        account: account(),
        linked: linked({ [field]: evidence.missing(field === "riskLabel" || field === "funder" ? null : 0, "x.y", "down") }),
        observedAt: NOW,
      });
      assert.equal(d.linked?.used, false, field);
      assert.equal(d.linked?.excludedFor, "missing-risk-check", field);
      assert.equal(d.final, false, field);
      assert.ok(d.missing.includes(`linked.${field}`), field);
      assert.equal(d.facts.priorLiquidations, 0);
    }
  });

  it("never attests a missing positive fact as zero without saying so", () => {
    const d = deriveFacts({ account: account(), linked: linked({ stableBalance: evidence.missing(0, "zerion.positions", "down") }), observedAt: NOW });
    assert.equal(d.final, false);
    assert.deepEqual(d.missing, ["linked.stableBalance"]);
    assert.equal(d.linked?.used, true, "a missing balance hides no risk, so the preview still counts the rest");
  });

  it("with allowPartial, reports conservatively instead", () => {
    const d = deriveFacts({
      account: account(),
      linked: linked({ stableBalance: evidence.missing(0, "zerion.positions"), liquidations: evidence.missing(0, "etherscan.logs") }),
      observedAt: NOW,
      options: { allowPartial: true },
    });
    assert.equal(d.final, true);
    assert.equal(d.linked?.used, false, "a missing risk check still leaves the wallet out");
    assert.equal(d.facts.stableBalance, 37_600_000n);
  });

  it("treats a value that is not a sane integer as missing, never as zero", () => {
    const d = deriveFacts({ account: account({ sentCount: evidence.ok(Number.NaN, "zerion.transactions") }), observedAt: NOW });
    assert.equal(d.final, false);
    assert.deepEqual(d.missing, ["account.sentCount"]);
  });

  it("saturates at the contract's widths instead of wrapping", () => {
    const d = deriveFacts({
      account: account({ sentCount: evidence.ok(Number.MAX_SAFE_INTEGER, "x"), stableBalance: evidence.ok(Number.MAX_SAFE_INTEGER, "x") }),
      linked: linked({
        sentCount: evidence.ok(Number.MAX_SAFE_INTEGER, "x"),
        stableBalance: evidence.ok(Number.MAX_SAFE_INTEGER, "x"),
        liquidations: evidence.ok(1_000_000, "x"),
        firstSeenAt: evidence.ok<number | null>(0, "x"),
      }),
      observedAt: NOW,
    });
    assert.equal(d.facts.txCount, U32_MAX);
    assert.equal(d.facts.priorLiquidations, U16_MAX);
    assert.ok(d.facts.stableBalance <= U64_MAX);
    assert.equal(d.facts.walletAgeDays, Math.floor(NOW / DAY_SECONDS));
  });

  it("reads a first sighting in the future as a new account", () => {
    const d = deriveFacts({ account: account({ firstSeenAt: evidence.ok<number | null>(NOW + 3600, "x") }), observedAt: NOW });
    assert.equal(d.facts.walletAgeDays, 0);
  });

  it("ignores a linked wallet that is the account itself", () => {
    const d = deriveFacts({ account: account(), linked: { ...linked(), address: ACCOUNT }, observedAt: NOW });
    assert.equal(d.linked, null);
  });

  it("refuses an unknown version rather than guessing its rules", () => {
    assert.throws(() => deriveFacts({ account: account(), observedAt: NOW, options: { version: 2 } }), /unknown facts version/);
  });

  it("is deterministic: the same evidence, even after a JSON round trip, gives the same report bytes", () => {
    const input = { user: ACCOUNT, observedAt: NOW, account: account(), linked: linked({}, coinbase), linkVerified: true };
    const again = JSON.parse(JSON.stringify(input));
    const a = underwrite(input);
    const b = underwrite(again);
    assert.equal(a.report, b.report);
    assert.equal(a.report, encodeUnderwriteReport(ACCOUNT, a.facts));
  });
});

describe("underwrite: what may be reported", () => {
  it("never reports a linked wallet whose ownership was not proven, not even with allowPartial", () => {
    const out = underwrite({ user: ACCOUNT, observedAt: NOW, account: account(), linked: linked(), options: { allowPartial: true } });
    assert.equal(out.final, false);
    assert.ok(out.missing.includes("linked.ownership"));
    assert.equal(out.report, null);
  });

  it("asks the buyer to confirm, rather than to wait, when only the signature is missing", () => {
    const out = underwrite({ user: ACCOUNT, observedAt: NOW, account: account(), linked: linked({}, coinbase) });
    assert.deepEqual(out.missing, ["linked.ownership"]);
    assert.match(out.decision.headline, /^Confirm with your wallet to open a \$\d/);
    assert.equal(out.decision.nextSteps[0]?.id, "link-history");
    assert.ok(!out.decision.nextSteps.some((s) => s.id === "retry"));
  });

  it("reports a proven linked wallet", () => {
    const out = underwrite({ user: ACCOUNT, observedAt: NOW, account: account(), linked: linked(), linkVerified: true });
    assert.equal(out.final, true);
    assert.match(out.report ?? "", /^0x[0-9a-f]{640}$/);
  });

  it("stamps the facts with the caller's clock, never its own", () => {
    const out = underwrite({ user: ACCOUNT, observedAt: 1_700_000_000, account: account(), linkVerified: true });
    assert.equal(out.facts.observedAt, 1_700_000_000n);
  });

  it("keeps the preview when not final, so the app can show a floor", () => {
    const out = underwrite({ user: ACCOUNT, observedAt: NOW, account: account({ stableBalance: evidence.missing(0, "rpc.balance") }) });
    assert.equal(out.final, false);
    assert.equal(out.report, null);
    assert.equal(out.decision.limit, 200_000_000n);
    assert.equal(out.decision.headline, "Your line is $200 for now. We're finishing a check on your history.");
    assert.equal(out.decision.nextSteps[0]?.id, "retry");
  });
});
