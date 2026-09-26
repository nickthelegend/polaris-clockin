/**
 * Gasless payments: every action a buyer or merchant takes on PolarisPayments
 * can arrive as a signature that a relayer submits. Each test names what a
 * signature commits to, or the attack a relayer would try with it.
 *
 * Buyers and gasless merchants here are fresh wallets that never hold MON, so
 * any test that passes proves the flow needs nothing from them but a
 * signature.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, setCode } = require("@nomicfoundation/hardhat-network-helpers");

const { MAX_UINT, signTyped, signPermit, signReceive, signTransfer, paymentId } = require("../helpers/sign");

const AUSD = (n) => ethers.parseUnits(String(n), 6);
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

const CANCEL_TYPES = {
  CancelSubscription: [
    { name: "subId", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/** A wallet with no MON at all: whatever it does, it does by signature. */
function gaslessWallet() {
  return ethers.Wallet.createRandom().connect(ethers.provider);
}

async function deployPayments(owner, ausd, treasury, minPeriod = 0) {
  return (await ethers.getContractFactory("PolarisPayments")).deploy(
    owner.address,
    await ausd.getAddress(),
    treasury.address,
    minPeriod
  );
}

describe("PolarisPayments: gasless payments", () => {
  let ausd, pay, payAddr;
  let owner, relayer, merchant, rival, treasury, checkout, operator, stranger, keeper;
  let buyer;

  beforeEach(async () => {
    [owner, relayer, merchant, rival, treasury, checkout, operator, stranger, keeper] =
      await ethers.getSigners();
    ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
    pay = await deployPayments(owner, ausd, treasury);
    payAddr = await pay.getAddress();

    buyer = gaslessWallet();
    await ausd.mint(buyer.address, AUSD(1_000));
  });

  /** The buyer's ReceiveWithAuthorization for one order, payable to PolarisPayments. */
  function signOrder(signer, merchantAddr, orderId, amount, opts) {
    return signReceive(ausd, signer, payAddr, amount, paymentId(merchantAddr, orderId), opts);
  }

  function submit(from, payerAddr, merchantAddr, orderId, a, amount = a.value) {
    return pay
      .connect(from)
      .payWithAuthorization(payerAddr, merchantAddr, amount, orderId, a.validAfter, a.validBefore, a.v, a.r, a.s);
  }

  describe("pay with an ERC-3009 authorization", () => {
    it("a buyer pays with a signature and nothing else: holds AUSD, never approves, relayer submits", async () => {
      expect(await ethers.provider.getBalance(buyer.address)).to.equal(0n);
      expect(await ausd.allowance(buyer.address, payAddr)).to.equal(0n);

      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      const id = paymentId(merchant.address, "ORD-1");

      await expect(submit(relayer, buyer.address, merchant.address, "ORD-1", a))
        .to.emit(pay, "PaymentMade")
        .withArgs(id, buyer.address, merchant.address, AUSD(100), AUSD(0.5), "ORD-1");

      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(900));
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(99.5));
      expect(await ausd.balanceOf(treasury.address)).to.equal(AUSD(0.5));
      expect(await ausd.balanceOf(payAddr)).to.equal(0n, "nothing may be left behind in the contract");

      // Still no gas, still no allowance: the signature was the whole consent.
      expect(await ethers.provider.getBalance(buyer.address)).to.equal(0n);
      expect(await ausd.allowance(buyer.address, payAddr)).to.equal(0n);

      const p = await pay.paymentFor(merchant.address, "ORD-1");
      expect(p.payer).to.equal(buyer.address, "the signer is the payer, not the relayer");
      expect(p.merchant).to.equal(merchant.address);
      expect(p.amount).to.equal(AUSD(100));
      expect(await pay.paymentCount()).to.equal(1n);
      expect(await ausd.authorizationState(buyer.address, id)).to.equal(true);
    });

    it("a relayer cannot redirect a payment to another merchant", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));

      // Same signature, rival merchant: the derived nonce changes, so the token
      // no longer recognises the buyer's signature.
      await expect(
        submit(relayer, buyer.address, rival.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");

      expect(await ausd.balanceOf(rival.address)).to.equal(0n);
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(1_000));
      expect((await pay.paymentFor(rival.address, "ORD-1")).paidAt).to.equal(0n);

      // The honest submission still goes through afterwards.
      await submit(relayer, buyer.address, merchant.address, "ORD-1", a);
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(99.5));
    });

    it("a signature for one order cannot pay another", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));

      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-2", a)
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");
      expect((await pay.paymentFor(merchant.address, "ORD-2")).paidAt).to.equal(0n);

      await submit(relayer, buyer.address, merchant.address, "ORD-1", a);
      expect((await pay.paymentFor(merchant.address, "ORD-1")).payer).to.equal(buyer.address);
    });

    it("a relayer cannot change the amount the buyer signed for", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a, AUSD(500))
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a, AUSD(1))
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");
    });

    it("a relayer cannot charge someone who did not sign", async () => {
      const victim = gaslessWallet();
      await ausd.mint(victim.address, AUSD(1_000));
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));

      await expect(
        submit(relayer, victim.address, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");
      expect(await ausd.balanceOf(victim.address)).to.equal(AUSD(1_000));
    });

    it("a replayed authorization fails", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await submit(relayer, buyer.address, merchant.address, "ORD-1", a);

      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");
      await expect(
        submit(stranger, buyer.address, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");

      // And the token independently holds the nonce as spent.
      expect(await ausd.authorizationState(buyer.address, paymentId(merchant.address, "ORD-1"))).to.equal(true);
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(900), "charged exactly once");
    });

    it("an order cannot be paid twice even with a fresh signature", async () => {
      const first = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await submit(relayer, buyer.address, merchant.address, "ORD-1", first);

      // The same buyer signs again with a new window: a different signature.
      const deadline = BigInt(await time.latest()) + 3600n;
      const again = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100), { validBefore: deadline });
      expect(again.signature).to.not.equal(first.signature);
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", again)
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");

      // A different buyer's fresh nonce space does not reopen the order either.
      const second = gaslessWallet();
      await ausd.mint(second.address, AUSD(1_000));
      const theirs = await signOrder(second, merchant.address, "ORD-1", AUSD(100));
      await expect(
        submit(relayer, second.address, merchant.address, "ORD-1", theirs)
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");

      expect(await ausd.balanceOf(second.address)).to.equal(AUSD(1_000));
      expect(await ausd.authorizationState(second.address, paymentId(merchant.address, "ORD-1"))).to.equal(false);
      expect(await pay.paymentCount()).to.equal(1n);
    });

    it("the fee split is identical to pay()", async () => {
      // An odd fee and an odd amount, so any difference in rounding shows.
      await pay.setFeeBps(137);
      const amount = AUSD("123.456789");
      const expectedFee = (amount * 137n) / 10_000n;

      await ausd.mint(rival.address, AUSD(1_000));
      await ausd.connect(rival).approve(payAddr, amount);

      const m0 = await ausd.balanceOf(merchant.address);
      const t0 = await ausd.balanceOf(treasury.address);
      await expect(pay.connect(rival).pay(merchant.address, amount, "DIRECT"))
        .to.emit(pay, "PaymentMade")
        .withArgs(paymentId(merchant.address, "DIRECT"), rival.address, merchant.address, amount, expectedFee, "DIRECT");
      const directNet = (await ausd.balanceOf(merchant.address)) - m0;
      const directFee = (await ausd.balanceOf(treasury.address)) - t0;

      const a = await signOrder(buyer, merchant.address, "SIGNED", amount);
      const m1 = await ausd.balanceOf(merchant.address);
      const t1 = await ausd.balanceOf(treasury.address);
      await expect(submit(relayer, buyer.address, merchant.address, "SIGNED", a))
        .to.emit(pay, "PaymentMade")
        .withArgs(paymentId(merchant.address, "SIGNED"), buyer.address, merchant.address, amount, expectedFee, "SIGNED");
      const signedNet = (await ausd.balanceOf(merchant.address)) - m1;
      const signedFee = (await ausd.balanceOf(treasury.address)) - t1;

      expect(signedNet).to.equal(directNet);
      expect(signedFee).to.equal(directFee);
      expect(signedFee).to.equal(expectedFee);
      expect(signedNet + signedFee).to.equal(amount);
    });

    it("takes no fee when the fee is zero, and still pays the merchant in full", async () => {
      await pay.setFeeBps(0);
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(40));
      await expect(submit(relayer, buyer.address, merchant.address, "ORD-1", a))
        .to.emit(pay, "PaymentMade")
        .withArgs(paymentId(merchant.address, "ORD-1"), buyer.address, merchant.address, AUSD(40), 0n, "ORD-1");
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(40));
      expect(await ausd.balanceOf(treasury.address)).to.equal(0n);
    });

    it("a direct pay() and a signed payment of the same order collide whichever lands first", async () => {
      await ausd.mint(rival.address, AUSD(1_000));
      await ausd.connect(rival).approve(payAddr, AUSD(1_000));

      // Direct first: the buyer's signature is refused and never spent.
      await pay.connect(rival).pay(merchant.address, AUSD(100), "ORD-A");
      const a = await signOrder(buyer, merchant.address, "ORD-A", AUSD(100));
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-A", a)
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(1_000));
      expect(await ausd.authorizationState(buyer.address, paymentId(merchant.address, "ORD-A"))).to.equal(false);
      expect((await pay.paymentFor(merchant.address, "ORD-A")).payer).to.equal(rival.address);

      // Signed first: the direct payment is refused and takes nothing.
      const b = await signOrder(buyer, merchant.address, "ORD-B", AUSD(100));
      await submit(relayer, buyer.address, merchant.address, "ORD-B", b);
      const rivalBefore = await ausd.balanceOf(rival.address);
      await expect(
        pay.connect(rival).pay(merchant.address, AUSD(100), "ORD-B")
      ).to.be.revertedWithCustomError(pay, "DuplicatePayment");
      expect(await ausd.balanceOf(rival.address)).to.equal(rivalBefore);
      expect((await pay.paymentFor(merchant.address, "ORD-B")).payer).to.equal(buyer.address);
    });

    it("an authorization naming another payee cannot be used", async () => {
      const nonce = paymentId(merchant.address, "ORD-1");

      // Signed straight to the merchant instead of to PolarisPayments.
      const toMerchant = await signReceive(ausd, buyer, merchant.address, AUSD(100), nonce);
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", toMerchant)
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");

      // A transfer authorization is a different message, even with the right payee and nonce.
      const transfer = await signTransfer(ausd, buyer, payAddr, AUSD(100), nonce);
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", transfer)
      ).to.be.revertedWithCustomError(ausd, "InvalidAuthorizationSignature");

      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(1_000));
      expect((await pay.paymentFor(merchant.address, "ORD-1")).paidAt).to.equal(0n);
    });

    it("an authorization lifted from the mempool cannot be sent to the token directly, skipping the payment record", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await expect(
        ausd
          .connect(relayer)
          .receiveWithAuthorization(buyer.address, payAddr, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s)
      ).to.be.revertedWithCustomError(ausd, "CallerMustBePayee");

      // Still usable for the order it was signed for.
      await submit(relayer, buyer.address, merchant.address, "ORD-1", a);
      expect((await pay.paymentFor(merchant.address, "ORD-1")).payer).to.equal(buyer.address);
    });

    it("an expired authorization pays nothing and leaves the order open", async () => {
      const validBefore = BigInt(await time.latest()) + 60n;
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100), { validBefore });
      await time.increase(120);

      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(ausd, "AuthorizationExpired");

      // The payment record written before the pull was rolled back with it.
      expect((await pay.paymentFor(merchant.address, "ORD-1")).paidAt).to.equal(0n);
      expect(await pay.paymentCount()).to.equal(0n);

      const fresh = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await submit(relayer, buyer.address, merchant.address, "ORD-1", fresh);
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(99.5));
    });

    it("an authorization cannot be used before its window opens", async () => {
      const validAfter = BigInt(await time.latest()) + 3600n;
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100), { validAfter });
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(ausd, "AuthorizationNotYetValid");

      await time.increaseTo(validAfter + 1n);
      await submit(relayer, buyer.address, merchant.address, "ORD-1", a);
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(99.5));
    });

    it("a token that reports success without delivering cannot mark an order paid", async () => {
      // Answers every call with 32 zero bytes: `receiveWithAuthorization`
      // "succeeds" and every balance reads zero.
      const liar = ethers.Wallet.createRandom().address;
      await setCode(liar, "0x60206000f3");
      const hollow = await (await ethers.getContractFactory("PolarisPayments")).deploy(
        owner.address,
        liar,
        treasury.address,
        0
      );

      const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };
      await expect(
        hollow
          .connect(relayer)
          .payWithAuthorization(buyer.address, merchant.address, AUSD(100), "ORD-1", 0, MAX_UINT, sig.v, sig.r, sig.s)
      )
        .to.be.revertedWithCustomError(hollow, "UnexpectedAmount")
        .withArgs(AUSD(100), 0n);
      expect(await hollow.paymentCount()).to.equal(0n);
    });

    it("refuses a zero payer, a zero merchant and a zero amount", async () => {
      const a = await signOrder(buyer, merchant.address, "ORD-1", AUSD(100));
      await expect(
        submit(relayer, ethers.ZeroAddress, merchant.address, "ORD-1", a)
      ).to.be.revertedWithCustomError(pay, "ZeroAddress");
      await expect(
        submit(relayer, buyer.address, ethers.ZeroAddress, "ORD-1", a)
      ).to.be.revertedWithCustomError(pay, "ZeroAddress");
      await expect(
        submit(relayer, buyer.address, merchant.address, "ORD-1", a, 0n)
      ).to.be.revertedWithCustomError(pay, "ZeroAmount");
    });
  });

  describe("relayed subscriptions", () => {
    let planId;

    beforeEach(async () => {
      await pay.connect(merchant).createPlan(AUSD(20), MONTH, "Pro");
      planId = await pay.planCount();
      await pay.setCheckout(checkout.address);
    });

    /** The buyer's permit for a year of periods, submitted by the checkout. */
    async function permitYear(signer) {
      const p = await signPermit(ausd, signer, payAddr, AUSD(20) * 12n);
      await ausd.connect(checkout).permit(signer.address, payAddr, p.value, p.deadline, p.v, p.r, p.s);
    }

    it("only the checkout can subscribe on someone's behalf", async () => {
      await permitYear(buyer);

      for (const caller of [stranger, relayer, owner, merchant]) {
        await expect(
          pay.connect(caller).subscribeFor(buyer.address, planId)
        ).to.be.revertedWithCustomError(pay, "NotCheckout");
      }
      await expect(
        pay.connect(stranger).setCheckout(stranger.address)
      ).to.be.revertedWithCustomError(pay, "OwnableUnauthorizedAccount");

      await expect(pay.connect(checkout).subscribeFor(buyer.address, planId))
        .to.emit(pay, "Subscribed")
        .withArgs(1n, planId, buyer.address);

      // Clearing the checkout switches relayed subscriptions off.
      await expect(pay.setCheckout(ethers.ZeroAddress)).to.emit(pay, "CheckoutSet").withArgs(ethers.ZeroAddress);
      const other = gaslessWallet();
      await ausd.mint(other.address, AUSD(100));
      await permitYear(other);
      await expect(
        pay.connect(checkout).subscribeFor(other.address, planId)
      ).to.be.revertedWithCustomError(pay, "NotCheckout");
    });

    it("a fresh deployment lets nobody subscribe on someone's behalf until a checkout is appointed", async () => {
      const fresh = await deployPayments(owner, ausd, treasury);
      expect(await fresh.checkout()).to.equal(ethers.ZeroAddress);
      await expect(
        fresh.connect(checkout).subscribeFor(buyer.address, 1)
      ).to.be.revertedWithCustomError(fresh, "NotCheckout");
      await expect(fresh.setCheckout(checkout.address)).to.emit(fresh, "CheckoutSet").withArgs(checkout.address);
    });

    it("subscribeFor takes the first period from the subscriber, not the checkout", async () => {
      // The worst case: the checkout itself holds AUSD and has approved us.
      await ausd.mint(checkout.address, AUSD(1_000));
      await ausd.connect(checkout).approve(payAddr, MAX_UINT);
      await permitYear(buyer);

      const checkoutBefore = await ausd.balanceOf(checkout.address);
      await expect(pay.connect(checkout).subscribeFor(buyer.address, planId))
        .to.emit(pay, "SubscriptionCharged")
        .withArgs(1n, AUSD(20), AUSD(0.1), 1);

      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(980));
      expect(await ausd.balanceOf(checkout.address)).to.equal(checkoutBefore);
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(19.9));
      expect(await ausd.balanceOf(treasury.address)).to.equal(AUSD(0.1));

      const s = await pay.getSubscription(1);
      expect(s.subscriber).to.equal(buyer.address);
      expect(s.periodsCharged).to.equal(1);
      expect(await pay.subscriptionOf(buyer.address, planId)).to.equal(1n);

      // Renewals keep drawing from the subscriber, without the checkout.
      await time.increase(MONTH + 1);
      await pay.connect(keeper).chargeDue(1);
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(960));
      expect(await ausd.balanceOf(checkout.address)).to.equal(checkoutBefore);
      expect(await ethers.provider.getBalance(buyer.address)).to.equal(0n);
    });

    it("the checkout cannot subscribe someone who granted no allowance", async () => {
      await ausd.mint(checkout.address, AUSD(1_000));
      await ausd.connect(checkout).approve(payAddr, MAX_UINT);

      await expect(
        pay.connect(checkout).subscribeFor(buyer.address, planId)
      ).to.be.revertedWithCustomError(ausd, "ERC20InsufficientAllowance");
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(1_000));
      expect(await pay.subscriptionCount()).to.equal(0n);
    });

    it("a relayed subscription blocks a double subscribe just like a direct one", async () => {
      await permitYear(buyer);
      await pay.connect(checkout).subscribeFor(buyer.address, planId);
      await expect(
        pay.connect(checkout).subscribeFor(buyer.address, planId)
      ).to.be.revertedWithCustomError(pay, "AlreadySubscribed");

      // A direct subscriber is also recognised by the relayed path.
      await ausd.mint(rival.address, AUSD(100));
      await ausd.connect(rival).approve(payAddr, AUSD(100));
      await pay.connect(rival).subscribe(planId);
      await expect(
        pay.connect(checkout).subscribeFor(rival.address, planId)
      ).to.be.revertedWithCustomError(pay, "AlreadySubscribed");
    });

    it("the checkout cannot subscribe anyone to a retired plan or on behalf of the zero address", async () => {
      await permitYear(buyer);
      await expect(
        pay.connect(checkout).subscribeFor(ethers.ZeroAddress, planId)
      ).to.be.revertedWithCustomError(pay, "ZeroAddress");

      await pay.connect(merchant).deactivatePlan(planId);
      await expect(
        pay.connect(checkout).subscribeFor(buyer.address, planId)
      ).to.be.revertedWithCustomError(pay, "PlanNotActive");
    });
  });

  describe("operators for merchants who hold no gas", () => {
    let shop;

    beforeEach(async () => {
      shop = gaslessWallet();
      await expect(pay.setOperator(operator.address, true))
        .to.emit(pay, "OperatorSet")
        .withArgs(operator.address, true);
    });

    it("an operator can create a plan for a merchant who holds no gas and a stranger cannot", async () => {
      await expect(pay.connect(operator).createPlanFor(shop.address, AUSD(10), MONTH, "Basic"))
        .to.emit(pay, "PlanCreated")
        .withArgs(1n, shop.address, AUSD(10), MONTH);

      const plan = await pay.getPlan(1);
      expect(plan.merchant).to.equal(shop.address);
      expect(plan.active).to.equal(true);
      expect(plan.name).to.equal("Basic");

      await expect(
        pay.connect(stranger).createPlanFor(stranger.address, AUSD(10), MONTH, "Mine")
      ).to.be.revertedWithCustomError(pay, "NotOperator");
      await expect(
        pay.connect(stranger).createPlanFor(shop.address, AUSD(10), MONTH, "Theirs")
      ).to.be.revertedWithCustomError(pay, "NotOperator");

      // The plan pays the merchant it names, not the operator that created it.
      await ausd.mint(rival.address, AUSD(100));
      await ausd.connect(rival).approve(payAddr, AUSD(100));
      await pay.connect(rival).subscribe(1);
      expect(await ausd.balanceOf(shop.address)).to.equal(AUSD(9.95));
      expect(await ausd.balanceOf(operator.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(shop.address)).to.equal(0n);
    });

    it("the owner may create a plan for a merchant too, and a revoked operator may not", async () => {
      await pay.connect(owner).createPlanFor(shop.address, AUSD(10), MONTH, "ByOwner");
      expect((await pay.getPlan(1)).merchant).to.equal(shop.address);

      await expect(pay.setOperator(operator.address, false))
        .to.emit(pay, "OperatorSet")
        .withArgs(operator.address, false);
      await expect(
        pay.connect(operator).createPlanFor(shop.address, AUSD(10), MONTH, "Late")
      ).to.be.revertedWithCustomError(pay, "NotOperator");
    });

    it("only the owner appoints operators", async () => {
      await expect(
        pay.connect(stranger).setOperator(stranger.address, true)
      ).to.be.revertedWithCustomError(pay, "OwnableUnauthorizedAccount");
    });

    it("an operator's plan meets the same rules as one a merchant creates itself", async () => {
      await expect(
        pay.connect(operator).createPlanFor(shop.address, AUSD(10), 60, "TooShort")
      ).to.be.revertedWithCustomError(pay, "InvalidPeriod");
      await expect(
        pay.connect(operator).createPlanFor(shop.address, AUSD(10), 400 * DAY, "TooLong")
      ).to.be.revertedWithCustomError(pay, "InvalidPeriod");
      await expect(
        pay.connect(operator).createPlanFor(shop.address, 0, MONTH, "Free")
      ).to.be.revertedWithCustomError(pay, "ZeroAmount");
      await expect(
        pay.connect(operator).createPlanFor(ethers.ZeroAddress, AUSD(10), MONTH, "Nobody")
      ).to.be.revertedWithCustomError(pay, "ZeroAddress");
    });

    it("an operator can retire a gasless merchant's plan, a stranger cannot, and live subscribers keep paying", async () => {
      await pay.connect(operator).createPlanFor(shop.address, AUSD(10), MONTH, "Basic");
      await ausd.mint(rival.address, AUSD(100));
      await ausd.connect(rival).approve(payAddr, AUSD(100));
      await pay.connect(rival).subscribe(1);

      await expect(pay.connect(stranger).deactivatePlan(1)).to.be.revertedWithCustomError(pay, "NotSubscriber");
      await expect(pay.connect(operator).deactivatePlan(1)).to.emit(pay, "PlanDeactivated").withArgs(1n);

      // Retiring closes the plan to newcomers...
      await ausd.mint(stranger.address, AUSD(100));
      await ausd.connect(stranger).approve(payAddr, AUSD(100));
      await expect(pay.connect(stranger).subscribe(1)).to.be.revertedWithCustomError(pay, "PlanNotActive");

      // ...but does not cancel anyone already on it.
      await time.increase(MONTH + 1);
      await pay.connect(keeper).chargeDue(1);
      expect(await ausd.balanceOf(shop.address)).to.equal(AUSD(9.95) * 2n);
    });

    it("an operator cannot retire a plan that does not exist yet", async () => {
      await expect(pay.connect(operator).deactivatePlan(7)).to.be.revertedWithCustomError(pay, "PlanNotActive");
    });
  });

  describe("gasless cancel", () => {
    let planId;

    beforeEach(async () => {
      await pay.connect(merchant).createPlan(AUSD(20), MONTH, "Pro");
      planId = await pay.planCount();
      await pay.setCheckout(checkout.address);
    });

    /** A gasless subscriber, subscribed through the checkout. Returns the sub id. */
    async function subscribeGasless(signer, plan = planId) {
      const p = await signPermit(ausd, signer, payAddr, AUSD(20) * 12n);
      await ausd.connect(checkout).permit(signer.address, payAddr, p.value, p.deadline, p.v, p.r, p.s);
      await pay.connect(checkout).subscribeFor(signer.address, plan);
      return await pay.subscriptionCount();
    }

    function signCancel(signer, subId, deadline = MAX_UINT, verifier = pay) {
      return signTyped(signer, verifier, CANCEL_TYPES, { subId, deadline });
    }

    function submitCancel(from, subId, deadline, c) {
      return pay.connect(from).cancelWithSignature(subId, deadline, c.v, c.r, c.s);
    }

    it("signs under the PolarisPayments domain, version 1", async () => {
      const d = await pay.eip712Domain();
      expect(d.name).to.equal("PolarisPayments");
      expect(d.version).to.equal("1");
      expect(d.verifyingContract).to.equal(payAddr);
    });

    it("a subscriber cancels with a signature alone", async () => {
      const subId = await subscribeGasless(buyer);
      const c = await signCancel(buyer, subId);

      await expect(submitCancel(relayer, subId, MAX_UINT, c))
        .to.emit(pay, "SubscriptionCancelled")
        .withArgs(subId, buyer.address);
      expect((await pay.getSubscription(subId)).status).to.equal(1); // Cancelled

      // And it stops taking money.
      const before = await ausd.balanceOf(buyer.address);
      await time.increase(MONTH + 1);
      expect(await pay.isChargeDue(subId)).to.equal(false);
      await expect(pay.connect(keeper).chargeDue(subId)).to.be.revertedWithCustomError(pay, "SubscriptionNotActive");
      expect(await ausd.balanceOf(buyer.address)).to.equal(before);

      // The whole life of the subscription cost the subscriber no gas.
      expect(await ethers.provider.getBalance(buyer.address)).to.equal(0n);
    });

    it("a cancel signature cannot cancel a different subscription or be used after its deadline", async () => {
      await pay.connect(merchant).createPlan(AUSD(5), MONTH, "Lite");
      const first = await subscribeGasless(buyer, 1n);
      const second = await subscribeGasless(buyer, 2n);
      const neighbour = gaslessWallet();
      await ausd.mint(neighbour.address, AUSD(1_000));
      const theirs = await subscribeGasless(neighbour, 1n);

      const deadline = BigInt(await time.latest()) + 600n;
      const c = await signCancel(buyer, first, deadline);

      // Pointed at the buyer's other subscription, or at someone else's.
      await expect(submitCancel(relayer, second, deadline, c)).to.be.revertedWithCustomError(pay, "NotSubscriber");
      await expect(submitCancel(relayer, theirs, deadline, c)).to.be.revertedWithCustomError(pay, "NotSubscriber");
      expect((await pay.getSubscription(second)).status).to.equal(0);
      expect((await pay.getSubscription(theirs)).status).to.equal(0);

      // A stretched deadline is a different message too.
      await expect(
        submitCancel(relayer, first, deadline + 1n, c)
      ).to.be.revertedWithCustomError(pay, "NotSubscriber");

      // Past its deadline, the signature is dead.
      await time.increaseTo(deadline + 1n);
      await expect(submitCancel(relayer, first, deadline, c)).to.be.revertedWithCustomError(pay, "SignatureExpired");
      expect((await pay.getSubscription(first)).status).to.equal(0);
    });

    it("a signature is still good at the exact second of its deadline", async () => {
      const subId = await subscribeGasless(buyer);
      const deadline = BigInt(await time.latest()) + 100n;
      const c = await signCancel(buyer, subId, deadline);
      await time.setNextBlockTimestamp(deadline);
      await expect(submitCancel(relayer, subId, deadline, c)).to.emit(pay, "SubscriptionCancelled");
    });

    it("a stranger's signature cannot cancel someone else's subscription", async () => {
      const subId = await subscribeGasless(buyer);
      const forged = await signCancel(stranger, subId);
      await expect(submitCancel(stranger, subId, MAX_UINT, forged)).to.be.revertedWithCustomError(pay, "NotSubscriber");

      // Nor can the merchant or the checkout sign one for the subscriber.
      for (const signer of [merchant, checkout]) {
        const c = await signCancel(signer, subId);
        await expect(submitCancel(relayer, subId, MAX_UINT, c)).to.be.revertedWithCustomError(pay, "NotSubscriber");
      }
      expect((await pay.getSubscription(subId)).status).to.equal(0);
    });

    it("a garbage signature is refused as not the subscriber's", async () => {
      const subId = await subscribeGasless(buyer);
      await expect(
        pay.connect(relayer).cancelWithSignature(subId, MAX_UINT, 0, ethers.ZeroHash, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pay, "NotSubscriber");
    });

    it("a cancel signed for another deployment is refused", async () => {
      const subId = await subscribeGasless(buyer);
      const elsewhere = await deployPayments(owner, ausd, treasury);
      const c = await signCancel(buyer, subId, MAX_UINT, elsewhere);
      await expect(submitCancel(relayer, subId, MAX_UINT, c)).to.be.revertedWithCustomError(pay, "NotSubscriber");
    });

    it("a used cancel signature cannot be replayed, and cannot touch a later re-subscription", async () => {
      const oldSub = await subscribeGasless(buyer);
      const c = await signCancel(buyer, oldSub);
      await submitCancel(relayer, oldSub, MAX_UINT, c);

      await expect(
        submitCancel(relayer, oldSub, MAX_UINT, c)
      ).to.be.revertedWithCustomError(pay, "SubscriptionNotActive");

      // Re-subscribing to the same plan gets a new id the old signature never named.
      await pay.connect(checkout).subscribeFor(buyer.address, planId);
      const newSub = await pay.subscriptionCount();
      expect(newSub).to.not.equal(oldSub);
      await expect(submitCancel(relayer, newSub, MAX_UINT, c)).to.be.revertedWithCustomError(pay, "NotSubscriber");
      expect((await pay.getSubscription(newSub)).status).to.equal(0);
    });
  });

  describe("minimum period per deployment", () => {
    it("a one-minute demo deployment (minPeriod = 60) charges a renewal after a minute while the default deployment refuses a one-minute plan", async () => {
      const demo = await deployPayments(owner, ausd, treasury, 60);
      const demoAddr = await demo.getAddress();
      expect(await demo.minPeriod()).to.equal(60n);
      expect(await pay.minPeriod()).to.equal(3600n);

      // The default deployment refuses a one-minute plan by either route.
      await pay.setOperator(operator.address, true);
      await expect(pay.connect(merchant).createPlan(AUSD(1), 60, "Minute")).to.be.revertedWithCustomError(
        pay,
        "InvalidPeriod"
      );
      await expect(
        pay.connect(operator).createPlanFor(merchant.address, AUSD(1), 60, "Minute")
      ).to.be.revertedWithCustomError(pay, "InvalidPeriod");

      // The demo takes it, and the whole flow runs gasless.
      await demo.setOperator(operator.address, true);
      await demo.setCheckout(checkout.address);
      await demo.connect(operator).createPlanFor(merchant.address, AUSD(1), 60, "Minute");

      const p = await signPermit(ausd, buyer, demoAddr, AUSD(10));
      await ausd.connect(checkout).permit(buyer.address, demoAddr, p.value, p.deadline, p.v, p.r, p.s);
      await demo.connect(checkout).subscribeFor(buyer.address, 1);

      expect(await demo.isChargeDue(1)).to.equal(false);
      await expect(demo.connect(keeper).chargeDue(1)).to.be.revertedWithCustomError(demo, "NotDue");

      await time.increase(60);
      expect(await demo.isChargeDue(1)).to.equal(true);
      await expect(demo.connect(keeper).chargeDue(1))
        .to.emit(demo, "SubscriptionCharged")
        .withArgs(1n, AUSD(1), AUSD(0.005), 2);

      expect((await demo.getSubscription(1)).periodsCharged).to.equal(2);
      expect(await ausd.balanceOf(buyer.address)).to.equal(AUSD(998));
      expect(await ausd.balanceOf(merchant.address)).to.equal(AUSD(0.995) * 2n);
    });

    it("no deployment can go below a one-minute floor", async () => {
      await expect(deployPayments(owner, ausd, treasury, 59)).to.be.revertedWithCustomError(pay, "InvalidPeriod");
    });
  });
});
