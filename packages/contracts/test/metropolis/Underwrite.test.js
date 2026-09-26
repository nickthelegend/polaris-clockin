/**
 * Underwriting the first line.
 *
 * The Chainlink DON attests facts about a wallet's life elsewhere; the score is
 * computed on chain from those facts, never attested. These tests hold the
 * formula to a hand-computed table, hold the off-chain mirror to the contract,
 * and prove the guards around the one write that sets a score without
 * repayment history: it runs once, on fresh evidence, for a wallet with no
 * record, and it never opens a line above $1,000.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { scoreFromFacts } = require("../helpers/underwrite-mirror");

const AUSD = (n) => BigInt(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;
const GRACE = 3 * DAY;
const EVIDENCE_WINDOW = 15n * 60n;

const U16_MAX = 2 ** 16 - 1;
const U32_MAX = 2 ** 32 - 1;
const U64_MAX = 2n ** 64n - 1n;

const EMPTY = {
  walletAgeDays: 0,
  txCount: 0,
  stableBalance: 0n,
  defiTenureDays: 0,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: false,
};

/// Every positive signal exactly at its cap.
const BEST = {
  walletAgeDays: 900,
  txCount: 1250,
  stableBalance: AUSD(5_000),
  defiTenureDays: 900,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: true,
};

const facts = (overrides = {}, observedAt = 0n) => ({
  ...EMPTY,
  ...overrides,
  observedAt: BigInt(observedAt),
});

/*
 * The expected column is worked by hand from the specification, not from
 * either implementation, so the mirror and the contract cannot agree on the
 * same mistake:
 *   520 + min(age/30*2, 60) + min(tx/25, 50) + min(balance/$100, 50)
 *       + min(defi/30, 30) + (exchangeFunded ? 10 : 0)
 *       - 75*liquidations - min((related-3)*2, 80) when related > 3
 *   clamped to [300, 739]; declined when liquidations >= 2 or related >= 25.
 *
 * The positive caps sum to 720, so the 739 ceiling cannot be reached by any
 * input today; the BEST row pins the highest score the formula can produce.
 */
const VECTORS = [
  { name: "an empty wallet opens at the floor", f: {}, score: 520, declined: false },
  { name: "wallet age rounds down to whole months before doubling", f: { walletAgeDays: 59 }, score: 522, declined: false },
  { name: "wallet age earns two points a month", f: { walletAgeDays: 450 }, score: 550, declined: false },
  { name: "wallet age caps at 60 points", f: { walletAgeDays: 900 }, score: 580, declined: false },
  { name: "wallet age far past the cap earns nothing more", f: { walletAgeDays: 4_000_000_000 }, score: 580, declined: false },
  { name: "activity earns a point per 25 transactions", f: { txCount: 124 }, score: 524, declined: false },
  { name: "activity caps at 50 points", f: { txCount: 1250 }, score: 570, declined: false },
  { name: "activity far past the cap earns nothing more", f: { txCount: 999_999 }, score: 570, declined: false },
  { name: "a balance one unit under $100 earns nothing", f: { stableBalance: AUSD(100) - 1n }, score: 520, declined: false },
  { name: "balance earns a point per $100", f: { stableBalance: AUSD(250) }, score: 522, declined: false },
  { name: "balance caps at 50 points", f: { stableBalance: AUSD(5_000) }, score: 570, declined: false },
  { name: "a $10M balance earns nothing more", f: { stableBalance: AUSD(10_000_000) }, score: 570, declined: false },
  { name: "DeFi tenure earns a point a month", f: { defiTenureDays: 95 }, score: 523, declined: false },
  { name: "DeFi tenure caps at 30 points", f: { defiTenureDays: 900 }, score: 550, declined: false },
  { name: "DeFi tenure far past the cap earns nothing more", f: { defiTenureDays: 36_500 }, score: 550, declined: false },
  { name: "exchange funding adds 10", f: { exchangeFunded: true }, score: 530, declined: false },
  { name: "three related wallets cost nothing", f: { relatedWallets: 3 }, score: 520, declined: false },
  { name: "a fourth related wallet costs two points", f: { relatedWallets: 4 }, score: 518, declined: false },
  { name: "24 related wallets cost 42 and do not decline", f: { relatedWallets: 24 }, score: 478, declined: false },
  { name: "25 related wallets decline", f: { relatedWallets: 25 }, score: 476, declined: true },
  { name: "the cluster penalty caps at 80", f: { relatedWallets: 43 }, score: 440, declined: true },
  { name: "a huge cluster costs no more than the cap", f: { relatedWallets: 60_000 }, score: 440, declined: true },
  { name: "one prior liquidation costs 75 and does not decline", f: { priorLiquidations: 1 }, score: 445, declined: false },
  { name: "two prior liquidations decline", f: { priorLiquidations: 2 }, score: 370, declined: true },
  { name: "three prior liquidations clamp at the 300 floor", f: { priorLiquidations: 3 }, score: 300, declined: true },
  { name: "the best possible facts score 720, under the 739 ceiling", f: BEST, score: 720, declined: false },
  { name: "a strong wallet with one liquidation", f: { ...BEST, priorLiquidations: 1 }, score: 645, declined: false },
  { name: "a strong wallet in a small cluster", f: { ...BEST, relatedWallets: 10 }, score: 706, declined: false },
  { name: "a strong wallet declines on its cluster alone", f: { ...BEST, relatedWallets: 25 }, score: 676, declined: true },
  {
    name: "an ordinary wallet sums every signal",
    f: {
      walletAgeDays: 200,
      txCount: 300,
      stableBalance: AUSD(1_234.56),
      defiTenureDays: 61,
      relatedWallets: 5,
    },
    score: 554,
    declined: false,
  },
  {
    name: "every field at its maximum neither overflows nor escapes the floor",
    f: {
      walletAgeDays: U32_MAX,
      txCount: U32_MAX,
      stableBalance: U64_MAX,
      defiTenureDays: U32_MAX,
      priorLiquidations: U16_MAX,
      relatedWallets: U16_MAX,
      exchangeFunded: true,
    },
    score: 300,
    declined: true,
  },
];

/// Deterministic, so a failure reproduces.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("underwriting", () => {
  let ausd, scores, engine, vault, owner, writer, user, merchant, stranger;

  beforeEach(async () => {
    [owner, writer, user, merchant, stranger] = await ethers.getSigners();

    ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
    scores = await (await ethers.getContractFactory("ScoreManager")).deploy(owner.address);
    engine = await (
      await ethers.getContractFactory("PolarisLoanEngine")
    ).deploy(
      owner.address,
      await ausd.getAddress(),
      await scores.getAddress(),
      owner.address,
      GRACE,
      0
    );
    vault = await (
      await ethers.getContractFactory("CollateralVault")
    ).deploy(owner.address, await ausd.getAddress());

    await scores.setWriter(await engine.getAddress(), true);
    // The CRE receiver, in production.
    await scores.setWriter(writer.address, true);
    await scores.setCollateralVault(await vault.getAddress());
    await vault.setLoanEngine(await engine.getAddress());
    await vault.setSeizer(await engine.getAddress(), true);
    await engine.setCollateralVault(await vault.getAddress());
    await engine.setOriginator(owner.address, true);

    await ausd.mint(owner.address, AUSD(1_000_000));
    await ausd.approve(await engine.getAddress(), AUSD(1_000_000));
    await engine.fund(AUSD(500_000));

    for (const who of [user, stranger]) {
      await ausd.mint(who.address, AUSD(5_000));
      await ausd.connect(who).approve(await engine.getAddress(), AUSD(5_000));
      await ausd.connect(who).approve(await vault.getAddress(), AUSD(5_000));
    }
  });

  /// Facts observed at the latest block, so the report is a second old when it lands.
  async function fresh(overrides = {}) {
    return facts(overrides, await time.latest());
  }

  function borrow(who, principal) {
    return engine.createLoan(who.address, merchant.address, principal, 4, 14 * DAY);
  }

  describe("the JS mirror", () => {
    for (const v of VECTORS) {
      it(`agrees with the contract and the specification: ${v.name}`, async () => {
        const struct = facts(v.f);
        const mirror = scoreFromFacts(struct);
        const [score, declined] = await scores.scoreFromFacts(struct);

        expect(mirror).to.deep.equal({ score: v.score, declined: v.declined });
        expect(Number(score)).to.equal(v.score);
        expect(declined).to.equal(v.declined);
      });
    }

    it("agrees with the contract across a seeded sweep that straddles every threshold", async () => {
      const rand = mulberry32(0x5eed);
      const pick = (max) => Math.floor(rand() * (max + 1));
      for (let i = 0; i < 150; i++) {
        const struct = facts({
          walletAgeDays: pick(1_000),
          txCount: pick(1_400),
          stableBalance: BigInt(pick(6_000)) * 1_000_000n + BigInt(pick(999_999)),
          defiTenureDays: pick(1_000),
          priorLiquidations: pick(3),
          relatedWallets: pick(50),
          exchangeFunded: rand() < 0.5,
        });
        const mirror = scoreFromFacts(struct);
        const [score, declined] = await scores.scoreFromFacts(struct);
        const label = JSON.stringify(struct, (_, x) => (typeof x === "bigint" ? x.toString() : x));
        expect({ score: Number(score), declined }).to.deep.equal(mirror, label);
      }
    });
  });

  describe("recording a report", () => {
    it("sets the score, stamps first-seen and records the decline", async () => {
      const report = await fresh({ priorLiquidations: 2 });
      const tx = scores.connect(writer).underwrite(user.address, report);
      await expect(tx)
        .to.emit(scores, "Underwritten")
        .withArgs(user.address, 370, true, report.observedAt)
        .and.to.emit(scores, "ScoreChanged")
        .withArgs(user.address, 600, 370, "underwritten");

      const p = await scores.profileOf(user.address);
      expect(p.initialized).to.equal(true);
      expect(p.score).to.equal(370);
      expect(p.declined).to.equal(true);
      expect(p.firstSeenAt).to.equal(BigInt(await time.latest()));
    });

    it("an empty report opens the $200 floor line, below where a stranger reads today", async () => {
      await scores.connect(writer).underwrite(user.address, await fresh());
      expect(await scores.scoreOf(user.address)).to.equal(520);
      expect(await scores.baseLimitOf(user.address)).to.equal(AUSD(200));
    });

    it("only a writer can underwrite", async () => {
      for (const caller of [stranger, owner, user]) {
        await expect(
          scores.connect(caller).underwrite(user.address, await fresh(BEST))
        ).to.be.revertedWithCustomError(scores, "NotWriter");
      }

      await scores.setWriter(writer.address, false);
      await expect(
        scores.connect(writer).underwrite(user.address, await fresh(BEST))
      ).to.be.revertedWithCustomError(scores, "NotWriter");
      expect((await scores.profileOf(user.address)).initialized).to.equal(false);
    });
  });

  describe("evidence freshness", () => {
    it("a stale report is refused", async () => {
      const landsAt = BigInt(await time.latest()) + 100n;

      await time.setNextBlockTimestamp(landsAt);
      await expect(
        scores.connect(writer).underwrite(user.address, facts(BEST, landsAt - EVIDENCE_WINDOW - 1n))
      ).to.be.revertedWithCustomError(scores, "StaleEvidence");

      // Exactly fifteen minutes old is the last moment it is accepted.
      await time.setNextBlockTimestamp(landsAt + 1n);
      await expect(
        scores.connect(writer).underwrite(user.address, facts(BEST, landsAt + 1n - EVIDENCE_WINDOW))
      ).to.emit(scores, "Underwritten");
    });

    it("a report from the future is refused", async () => {
      const landsAt = BigInt(await time.latest()) + 100n;

      await time.setNextBlockTimestamp(landsAt);
      await expect(
        scores.connect(writer).underwrite(user.address, facts(BEST, landsAt + 1n))
      ).to.be.revertedWithCustomError(scores, "StaleEvidence");

      // Observed in the very block it lands in is fine.
      await time.setNextBlockTimestamp(landsAt + 1n);
      await expect(
        scores.connect(writer).underwrite(user.address, facts(BEST, landsAt + 1n))
      ).to.emit(scores, "Underwritten");
    });
  });

  describe("a record is written once", () => {
    it("a second underwrite cannot reset a bad record left by a liquidation", async () => {
      await borrow(user, AUSD(200));
      await time.increase(14 * DAY + GRACE + 1);
      await engine.liquidate(1);
      const scarred = await scores.scoreOf(user.address);
      expect(scarred).to.equal(600 - 150);

      // A clean-looking report of the same wallet cannot write over the default.
      await expect(
        scores.connect(writer).underwrite(user.address, await fresh(BEST))
      ).to.be.revertedWithCustomError(scores, "AlreadyHasRecord");

      expect(await scores.scoreOf(user.address)).to.equal(scarred);
      expect((await scores.profileOf(user.address)).liquidations).to.equal(1);
    });

    it("a second underwrite cannot lift a decline", async () => {
      await scores.connect(writer).underwrite(user.address, await fresh({ priorLiquidations: 2 }));
      await expect(
        scores.connect(writer).underwrite(user.address, await fresh(BEST))
      ).to.be.revertedWithCustomError(scores, "AlreadyHasRecord");

      expect((await scores.profileOf(user.address)).declined).to.equal(true);
      expect(await scores.baseLimitOf(user.address)).to.equal(0n);
    });

    it("a record earned by repaying cannot be overwritten by a report either", async () => {
      await borrow(user, AUSD(200));
      await engine.connect(user).repay(1, await engine.installmentAmount(1));
      const earned = await scores.scoreOf(user.address);

      await expect(
        scores.connect(writer).underwrite(user.address, await fresh({ priorLiquidations: 3 }))
      ).to.be.revertedWithCustomError(scores, "AlreadyHasRecord");
      expect(await scores.scoreOf(user.address)).to.equal(earned);
    });
  });

  describe("the line it opens", () => {
    it("an underwritten line never opens above $1,000", async () => {
      // Every positive fact at its cap and far beyond it.
      const extreme = {
        walletAgeDays: U32_MAX,
        txCount: U32_MAX,
        stableBalance: U64_MAX,
        defiTenureDays: U32_MAX,
        exchangeFunded: true,
      };
      const [best] = await scores.scoreFromFacts(facts(extreme));
      expect(best).to.equal(720n);
      expect(best).to.be.lessThanOrEqual(await scores.MAX_UNDERWRITTEN_SCORE());
      expect(await scores.MAX_UNDERWRITTEN_SCORE()).to.be.lessThan(740n); // the $2,500 tier

      await scores.connect(writer).underwrite(user.address, await fresh(extreme));
      expect(await scores.baseLimitOf(user.address)).to.equal(AUSD(1_000));
      expect(await scores.creditLimitOf(user.address)).to.equal(AUSD(1_000));

      // A plan owing more than $1,000 is refused; one inside the line opens.
      await expect(borrow(user, AUSD(1_000))).to.be.revertedWithCustomError(
        engine,
        "ExceedsCreditLimit"
      );
      await expect(borrow(user, AUSD(950))).to.not.be.reverted;
    });

    it("two liquidations decline the line", async () => {
      await expect(
        scores
          .connect(writer)
          .underwrite(user.address, await fresh({ ...BEST, priorLiquidations: 2 }))
      )
        .to.emit(scores, "Underwritten")
        .withArgs(user.address, 570, true, (v) => v > 0n);

      // A 570 would otherwise be the $200 tier: the decline, not the score, closes it.
      expect(await scores.baseLimitOf(user.address)).to.equal(0n);
      expect(await scores.creditLimitOf(user.address)).to.equal(0n);
      await expect(borrow(user, AUSD(10))).to.be.revertedWithCustomError(
        engine,
        "ExceedsCreditLimit"
      );
    });

    it("a sybil cluster declines the line", async () => {
      // 24 related wallets is a penalty; 25 is a decline, even on a 676.
      await scores
        .connect(writer)
        .underwrite(stranger.address, await fresh({ ...BEST, relatedWallets: 24 }));
      expect(await scores.baseLimitOf(stranger.address)).to.equal(AUSD(1_000));

      await scores
        .connect(writer)
        .underwrite(user.address, await fresh({ ...BEST, relatedWallets: 25 }));
      expect(await scores.scoreOf(user.address)).to.equal(676);
      expect(await scores.baseLimitOf(user.address)).to.equal(0n);
      await expect(borrow(user, AUSD(10))).to.be.revertedWithCustomError(
        engine,
        "ExceedsCreditLimit"
      );
    });

    it("collateral still opens a line for someone declined", async () => {
      await scores.connect(writer).underwrite(user.address, await fresh({ priorLiquidations: 2 }));
      expect(await scores.creditLimitOf(user.address)).to.equal(0n);

      await vault.connect(user).lock(AUSD(200));
      // 150% of what is locked, and nothing unsecured on top.
      expect(await scores.creditLimitOf(user.address)).to.equal(AUSD(300));
      await expect(borrow(user, AUSD(250))).to.not.be.reverted;
      await expect(borrow(user, AUSD(100))).to.be.revertedWithCustomError(
        engine,
        "ExceedsCreditLimit"
      );
    });
  });

  describe("requireUnderwriting", () => {
    it("only the owner can require underwriting", async () => {
      await expect(
        scores.connect(stranger).setRequireUnderwriting(true)
      ).to.be.revertedWithCustomError(scores, "OwnableUnauthorizedAccount");
      await expect(scores.setRequireUnderwriting(true))
        .to.emit(scores, "RequireUnderwritingSet")
        .withArgs(true);
      expect(await scores.requireUnderwriting()).to.equal(true);
    });

    it("with requireUnderwriting on, a stranger with no record gets no unsecured line", async () => {
      await scores.setRequireUnderwriting(true);

      expect(await scores.baseLimitOf(stranger.address)).to.equal(0n);
      expect(await scores.creditLimitOf(stranger.address)).to.equal(0n);
      await expect(borrow(stranger, AUSD(10))).to.be.revertedWithCustomError(
        engine,
        "ExceedsCreditLimit"
      );

      // Collateral is the way in without a report.
      await vault.connect(stranger).lock(AUSD(100));
      expect(await scores.creditLimitOf(stranger.address)).to.equal(AUSD(150));

      // And a report opens the unsecured line.
      await scores.connect(writer).underwrite(user.address, await fresh());
      expect(await scores.baseLimitOf(user.address)).to.equal(AUSD(200));
      await expect(borrow(user, AUSD(150))).to.not.be.reverted;
    });

    it("with requireUnderwriting on, history earned on the secured path still counts", async () => {
      await scores.setRequireUnderwriting(true);
      await vault.connect(stranger).lock(AUSD(200));
      await borrow(stranger, AUSD(200));
      await engine.connect(stranger).repay(1, await engine.installmentAmount(1));

      // The record came from repaying, which the chain observed itself.
      expect(await scores.scoreOf(stranger.address)).to.equal(612);
      expect(await scores.baseLimitOf(stranger.address)).to.equal(AUSD(500));
    });

    it("with it off, behaviour is exactly as before", async () => {
      expect(await scores.requireUnderwriting()).to.equal(false);

      const check = async () => {
        expect(await scores.scoreOf(stranger.address)).to.equal(600);
        expect(await scores.baseLimitOf(stranger.address)).to.equal(AUSD(500));
        expect(await scores.creditLimitOf(stranger.address)).to.equal(AUSD(500));
        const p = await scores.profileOf(stranger.address);
        expect(p.initialized).to.equal(false);
        expect(p.declined).to.equal(false);
      };

      await check();
      // Switching it on and off again leaves no trace.
      await scores.setRequireUnderwriting(true);
      await scores.setRequireUnderwriting(false);
      await check();
      await expect(borrow(stranger, AUSD(400))).to.not.be.reverted;
    });
  });
});
