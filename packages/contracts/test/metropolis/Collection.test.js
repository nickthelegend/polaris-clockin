/**
 * collectInstallment: the keeper's permissionless path, and repay made the
 * borrower's own.
 *
 * A permissionless repay that took an arbitrary amount let anyone pull a
 * borrower's whole standing allowance the day a plan opened. The Solana build
 * fixed the same hole by making the permissionless path take no amount. These
 * tests prove the EVM port of that fix: a stranger can collect only what the
 * schedule says is due, only once it is due, and a shortfall comes back as an
 * error the dunning ladder can act on.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const AUSD = (n) => BigInt(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;
const GRACE = 3 * DAY;
const INTERVAL = 14 * DAY;

const ACTIVE = 0;
const REPAID = 1;
const LIQUIDATED = 2;

/// A whole Polaris lending stack on MockAUSD. `minInterval` and `grace` are the
/// two per-deployment knobs a demo deployment turns down.
async function deploy({ minInterval = 0, grace = GRACE } = {}) {
  const [owner, borrower, merchant, stranger, keeper, other] = await ethers.getSigners();

  const ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
  const scores = await (await ethers.getContractFactory("ScoreManager")).deploy(owner.address);
  const engine = await (
    await ethers.getContractFactory("PolarisLoanEngine")
  ).deploy(
    owner.address,
    await ausd.getAddress(),
    await scores.getAddress(),
    owner.address,
    grace,
    minInterval
  );

  await scores.setWriter(await engine.getAddress(), true);
  await engine.setOriginator(owner.address, true);

  await ausd.mint(owner.address, AUSD(1_000_000));
  await ausd.approve(await engine.getAddress(), AUSD(1_000_000));
  await engine.fund(AUSD(500_000));

  // A standing allowance far larger than any one plan: exactly what a stranger
  // with an arbitrary-amount repay could have drained.
  for (const who of [borrower, other]) {
    await ausd.mint(who.address, AUSD(2_000));
    await ausd.connect(who).approve(await engine.getAddress(), AUSD(2_000));
  }

  return { ausd, scores, engine, owner, borrower, merchant, stranger, keeper, other };
}

describe("collection", () => {
  let ausd, scores, engine, owner, borrower, merchant, stranger, keeper, other;

  beforeEach(async () => {
    ({ ausd, scores, engine, owner, borrower, merchant, stranger, keeper, other } = await deploy());
  });

  async function openPlan(principal = AUSD(200), count = 4, interval = INTERVAL, who = borrower) {
    await engine.createLoan(who.address, merchant.address, principal, count, interval);
    return await engine.loanCount();
  }

  describe("a stranger collecting", () => {
    it("a stranger collects exactly the instalment due and not a unit more", async () => {
      const id = await openPlan();
      const due = await engine.installmentAmount(id);
      await time.increaseTo(await engine.installmentDueAt(id, 0));

      const walletBefore = await ausd.balanceOf(borrower.address);
      const allowanceBefore = await ausd.allowance(borrower.address, await engine.getAddress());
      const poolBefore = await ausd.balanceOf(await engine.getAddress());

      expect(await engine.connect(stranger).collectInstallment.staticCall(id)).to.equal(due);
      await expect(engine.connect(stranger).collectInstallment(id))
        .to.emit(engine, "InstallmentCollected")
        .withArgs(id, stranger.address, due)
        .and.to.emit(engine, "InstallmentPaid")
        .withArgs(id, borrower.address, 0, due, true);

      expect(await ausd.balanceOf(borrower.address)).to.equal(walletBefore - due);
      expect(await ausd.allowance(borrower.address, await engine.getAddress())).to.equal(
        allowanceBefore - due
      );
      expect(await ausd.balanceOf(await engine.getAddress())).to.equal(poolBefore + due);
      expect((await engine.getLoan(id)).installmentsPaid).to.equal(1);

      // The next instalment is two weeks out, so calling again takes nothing.
      await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
        engine,
        "NotDue"
      );
      expect(await ausd.balanceOf(borrower.address)).to.equal(walletBefore - due);
    });

    it("a stranger cannot drain a standing allowance the day a plan opens", async () => {
      const id = await openPlan();
      const walletBefore = await ausd.balanceOf(borrower.address);
      const allowanceBefore = await ausd.allowance(borrower.address, await engine.getAddress());

      // The old attack: an arbitrary amount through the permissionless path.
      await expect(
        engine.connect(stranger).repay(id, allowanceBefore)
      ).to.be.revertedWithCustomError(engine, "NotBorrower");
      // And the new permissionless path has nothing to take before the schedule says so.
      await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
        engine,
        "NotDue"
      );

      expect(await ausd.balanceOf(borrower.address)).to.equal(walletBefore);
      expect(await ausd.allowance(borrower.address, await engine.getAddress())).to.equal(
        allowanceBefore
      );
    });

    it("with several instalments overdue, each call collects one instalment and no more", async () => {
      const id = await openPlan();
      // Three of four instalments have fallen due.
      await time.increaseTo(await engine.installmentDueAt(id, 2));

      for (let i = 0; i < 3; i++) {
        const due = await engine.installmentAmount(id);
        const before = await ausd.balanceOf(borrower.address);
        await engine.connect(stranger).collectInstallment(id);
        expect(await ausd.balanceOf(borrower.address)).to.equal(before - due);
        expect((await engine.getLoan(id)).installmentsPaid).to.equal(i + 1);
      }

      // The fourth is not due yet, however many times it is asked for.
      await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
        engine,
        "NotDue"
      );
      expect((await engine.getLoan(id)).status).to.equal(ACTIVE);
    });

    it("after a partial prepayment, collection draws only the shortfall", async () => {
      const id = await openPlan();
      const due = await engine.installmentAmount(id);
      const half = due / 2n;
      await engine.connect(borrower).repay(id, half);

      await time.increaseTo(await engine.installmentDueAt(id, 0));
      await expect(engine.connect(stranger).collectInstallment(id))
        .to.emit(engine, "InstallmentCollected")
        .withArgs(id, stranger.address, due - half);

      const loan = await engine.getLoan(id);
      expect(loan.totalRepaid).to.equal(due);
      expect(loan.installmentsPaid).to.equal(1);
    });

    it("an instalment the borrower prepaid is not collected again when its date arrives", async () => {
      const id = await openPlan();
      await engine.connect(borrower).repay(id, await engine.installmentAmount(id));

      // Instalment 0's date: nothing is due, because instalment 0 is paid.
      await time.increaseTo(await engine.installmentDueAt(id, 0));
      await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
        engine,
        "NotDue"
      );

      // Instalment 1's date: now there is.
      await time.increaseTo(await engine.installmentDueAt(id, 1));
      await expect(engine.connect(stranger).collectInstallment(id))
        .to.emit(engine, "InstallmentPaid")
        .withArgs(id, borrower.address, 1, anyValue, true);
    });
  });

  describe("timing", () => {
    it("an instalment cannot be collected before it falls due", async () => {
      const id = await openPlan();
      const dueAt = await engine.installmentDueAt(id, 0);

      await time.setNextBlockTimestamp(dueAt - 1n);
      await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
        engine,
        "NotDue"
      );

      // The due timestamp itself is collectable, matching isInstallmentDue.
      await time.setNextBlockTimestamp(dueAt);
      await expect(engine.connect(stranger).collectInstallment(id)).to.not.be.reverted;
    });

    it("a late collection scores late and an on-time one on time", async () => {
      const id = await openPlan();
      const start = await scores.scoreOf(borrower.address);
      const bonus = await scores.ON_TIME_BONUS();
      const penalty = await scores.LATE_PENALTY();

      // Instalment 0 on the last second of its grace period: still on time,
      // the same instant liquidation is still refused.
      await time.setNextBlockTimestamp((await engine.installmentDueAt(id, 0)) + BigInt(GRACE));
      await expect(engine.connect(keeper).collectInstallment(id))
        .to.emit(engine, "InstallmentPaid")
        .withArgs(id, borrower.address, 0, anyValue, true)
        .and.to.emit(scores, "ScoreChanged")
        .withArgs(borrower.address, start, start + bonus, "on-time payment");

      // Instalment 1 one second after its grace period: late. The loan is
      // liquidatable at that moment, and the keeper's collection rescues it.
      const lateAt = (await engine.installmentDueAt(id, 1)) + BigInt(GRACE) + 1n;
      await time.increaseTo(lateAt);
      expect(await engine.checkLiquidatable(id)).to.equal(true);

      await expect(engine.connect(keeper).collectInstallment(id))
        .to.emit(engine, "InstallmentPaid")
        .withArgs(id, borrower.address, 1, anyValue, false)
        .and.to.emit(scores, "ScoreChanged")
        .withArgs(borrower.address, start + bonus, start + bonus - penalty, "late payment");

      expect(await engine.checkLiquidatable(id)).to.equal(false);
      const profile = await scores.profileOf(borrower.address);
      expect(profile.onTimePayments).to.equal(1);
      expect(profile.latePayments).to.equal(1);
    });
  });

  describe("shortfalls the dunning ladder can act on", () => {
    let id, due;

    beforeEach(async () => {
      id = await openPlan();
      due = await engine.installmentAmount(id);
      await time.increaseTo(await engine.installmentDueAt(id, 0));
    });

    it("a revoked allowance is reported as allowance lost (InsufficientAllowance) and a short balance as short on funds (InsufficientBalance)", async () => {
      const engineAddr = await engine.getAddress();

      // Allowance lost: revoked outright, then cut to one unit short.
      await ausd.connect(borrower).approve(engineAddr, 0);
      await expect(engine.connect(keeper).collectInstallment(id))
        .to.be.revertedWithCustomError(engine, "InsufficientAllowance")
        .withArgs(0n, due);

      await ausd.connect(borrower).approve(engineAddr, due - 1n);
      await expect(engine.connect(keeper).collectInstallment(id))
        .to.be.revertedWithCustomError(engine, "InsufficientAllowance")
        .withArgs(due - 1n, due);

      // Short on funds: the allowance is back, the wallet is one unit short.
      await ausd.connect(borrower).approve(engineAddr, AUSD(2_000));
      const balance = await ausd.balanceOf(borrower.address);
      await ausd.connect(borrower).transfer(owner.address, balance - (due - 1n));
      await expect(engine.connect(keeper).collectInstallment(id))
        .to.be.revertedWithCustomError(engine, "InsufficientBalance")
        .withArgs(due - 1n, due);

      // Topped up, the same call succeeds.
      await ausd.mint(borrower.address, 1n);
      await expect(engine.connect(keeper).collectInstallment(id))
        .to.emit(engine, "InstallmentCollected")
        .withArgs(id, keeper.address, due);
    });

    it("reports allowance lost first when both are short, since no balance is reachable without it", async () => {
      await ausd.connect(borrower).approve(await engine.getAddress(), 0);
      await ausd
        .connect(borrower)
        .transfer(owner.address, await ausd.balanceOf(borrower.address));

      await expect(engine.connect(keeper).collectInstallment(id))
        .to.be.revertedWithCustomError(engine, "InsufficientAllowance")
        .withArgs(0n, due);
    });
  });

  describe("the whole plan", () => {
    it("collecting every instalment closes the loan at exactly what is owed, with the protocol fee never above the interest earned", async () => {
      // Seven instalments on an odd principal, so the total rarely divides evenly.
      const id = await openPlan(AUSD(333.33), 7, 10 * DAY);
      const loan = await engine.getLoan(id);
      const interest = loan.totalOwed - loan.principal;
      const walletBefore = await ausd.balanceOf(borrower.address);
      const poolBefore = await ausd.balanceOf(await engine.getAddress());

      let collected = 0n;
      for (let i = 0; i < 7; i++) {
        await time.increaseTo(await engine.installmentDueAt(id, i));
        const due = await engine.installmentAmount(id);
        expect(due).to.be.greaterThan(0n);
        const tx = engine.connect(stranger).collectInstallment(id);
        if (i === 6) {
          await expect(tx).to.emit(engine, "LoanFullyRepaid").withArgs(id, borrower.address);
        } else {
          await tx;
        }
        collected += due;
      }

      expect(collected).to.equal(loan.totalOwed);
      expect(walletBefore - (await ausd.balanceOf(borrower.address))).to.equal(loan.totalOwed);
      expect(await ausd.balanceOf(await engine.getAddress())).to.equal(poolBefore + loan.totalOwed);
      expect(await engine.outstandingOf(id)).to.equal(0n);
      expect(await engine.activeDebtOf(borrower.address)).to.equal(0n);
      expect((await engine.getLoan(id)).status).to.equal(REPAID);
      expect((await engine.getLoan(id)).installmentsPaid).to.equal(7);

      const fees = await engine.protocolFeesAccrued();
      expect(fees).to.be.greaterThan(0n);
      expect(fees).to.be.lessThanOrEqual(interest);
    });

    it("a keeper's collection is booked exactly like the borrower's own payment, and only the collection says so", async () => {
      // Two identical plans opened in the same block, so their schedules match.
      await ethers.provider.send("evm_setAutomine", [false]);
      await engine.createLoan(borrower.address, merchant.address, AUSD(200), 4, INTERVAL);
      await engine.createLoan(other.address, merchant.address, AUSD(200), 4, INTERVAL);
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_setAutomine", [true]);
      const [paidId, collectedId] = [1n, 2n];
      expect(await engine.installmentDueAt(paidId, 0)).to.equal(
        await engine.installmentDueAt(collectedId, 0)
      );

      await time.increaseTo(await engine.installmentDueAt(paidId, 0));
      const due = await engine.installmentAmount(paidId);

      const feesBefore = await engine.protocolFeesAccrued();
      const paidTx = await engine.connect(borrower).repay(paidId, due);
      const feeOnPayment = (await engine.protocolFeesAccrued()) - feesBefore;
      const collectedTx = await engine.connect(keeper).collectInstallment(collectedId);
      const feeOnCollection = (await engine.protocolFeesAccrued()) - feesBefore - feeOnPayment;

      const [a, b] = [await engine.getLoan(paidId), await engine.getLoan(collectedId)];
      expect(b.totalRepaid).to.equal(a.totalRepaid);
      expect(b.installmentsPaid).to.equal(a.installmentsPaid);
      expect(b.status).to.equal(a.status);
      expect(feeOnCollection).to.equal(feeOnPayment);
      expect(await scores.scoreOf(other.address)).to.equal(await scores.scoreOf(borrower.address));

      const collectedEvents = async (tx) =>
        (await tx.wait()).logs.filter(
          (log) => log.fragment && log.fragment.name === "InstallmentCollected"
        ).length;
      expect(await collectedEvents(paidTx)).to.equal(0);
      expect(await collectedEvents(collectedTx)).to.equal(1);
    });
  });

  describe("who may pay what", () => {
    it("a stranger's repay reverts NotBorrower while the borrower can still prepay", async () => {
      const id = await openPlan();
      const owed = (await engine.getLoan(id)).totalOwed;

      for (const caller of [stranger, keeper, owner, merchant]) {
        await expect(engine.connect(caller).repay(id, 1n)).to.be.revertedWithCustomError(
          engine,
          "NotBorrower"
        );
      }

      // The borrower pays the whole plan off the day it opens.
      const before = await ausd.balanceOf(borrower.address);
      await expect(engine.connect(borrower).repay(id, owed))
        .to.emit(engine, "LoanFullyRepaid")
        .withArgs(id, borrower.address);
      expect(await ausd.balanceOf(borrower.address)).to.equal(before - owed);
      expect((await engine.getLoan(id)).status).to.equal(REPAID);
    });

    it("collectInstallment on a repaid or liquidated loan reverts", async () => {
      const repaidId = await openPlan();
      await engine.connect(borrower).repay(repaidId, (await engine.getLoan(repaidId)).totalOwed);

      const liquidatedId = await openPlan(AUSD(100), 4, INTERVAL, other);
      await time.increaseTo((await engine.installmentDueAt(liquidatedId, 0)) + BigInt(GRACE) + 1n);
      await engine.connect(keeper).liquidate(liquidatedId);
      expect((await engine.getLoan(liquidatedId)).status).to.equal(LIQUIDATED);

      // Both are well past their first due date, so only the status can refuse.
      for (const id of [repaidId, liquidatedId]) {
        await expect(engine.connect(stranger).collectInstallment(id)).to.be.revertedWithCustomError(
          engine,
          "LoanNotActive"
        );
      }
      await expect(engine.connect(stranger).collectInstallment(999)).to.be.revertedWithCustomError(
        engine,
        "InvalidLoan"
      );
    });
  });

  describe("the per-deployment minimum interval", () => {
    it("a one-minute demo deployment (minInterval = 60) runs a whole plan while a default deployment refuses a one-minute interval", async () => {
      // The default deployment, from beforeEach, keeps the one-hour floor.
      expect(await engine.minInterval()).to.equal(60n * 60n);
      await expect(
        engine.createLoan(borrower.address, merchant.address, AUSD(100), 4, 60)
      ).to.be.revertedWithCustomError(engine, "InvalidInterval");

      const demo = await deploy({ minInterval: 60, grace: 60 });
      expect(await demo.engine.minInterval()).to.equal(60n);
      // Even the demo refuses anything under a minute.
      await expect(
        demo.engine.createLoan(demo.borrower.address, demo.merchant.address, AUSD(100), 4, 59)
      ).to.be.revertedWithCustomError(demo.engine, "InvalidInterval");

      await demo.engine.createLoan(demo.borrower.address, demo.merchant.address, AUSD(100), 4, 60);
      const id = await demo.engine.loanCount();
      const loan = await demo.engine.getLoan(id);

      for (let i = 0; i < 4; i++) {
        await time.increaseTo(await demo.engine.installmentDueAt(id, i));
        await expect(demo.engine.connect(demo.keeper).collectInstallment(id))
          .to.emit(demo.engine, "InstallmentPaid")
          .withArgs(id, demo.borrower.address, i, anyValue, true);
      }

      const closed = await demo.engine.getLoan(id);
      expect(closed.status).to.equal(REPAID);
      expect(closed.totalRepaid).to.equal(loan.totalOwed);
      // Four minutes and a few blocks, start to finish.
      expect(BigInt(await time.latest()) - loan.startedAt).to.be.lessThan(5n * 60n);
    });
  });
});
