/**
 * MerchantRegistry operators: the platform registers merchants who hold no gas.
 *
 * Merchants sign up with Privy embedded wallets that never hold MON, so they
 * cannot send `register` themselves. An operator does it for them. What these
 * tests prove is that this is a delivery mechanism and not a privilege: the
 * entry an operator creates is exactly the one the merchant would have created,
 * an operator can do nothing else, and only the owner decides who is one.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const AUSD = (n) => BigInt(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;

describe("merchant registry operators", () => {
  let registry, owner, operator, merchant, stranger, payout;

  beforeEach(async () => {
    [owner, operator, merchant, stranger, payout] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("MerchantRegistry")).deploy(owner.address);
    await registry.setOperator(operator.address, true);
  });

  /// A Privy-style embedded wallet: an address with no MON, never funded.
  function gaslessWallet() {
    return ethers.Wallet.createRandom().connect(ethers.provider);
  }

  it("an operator can register a merchant who holds no gas", async () => {
    const shop = gaslessWallet();
    expect(await ethers.provider.getBalance(shop.address)).to.equal(0n);

    await expect(
      registry
        .connect(operator)
        .registerFor(shop.address, "Corner Shop", payout.address, "ipfs://shop")
    )
      .to.emit(registry, "MerchantRegistered")
      .withArgs(shop.address, "Corner Shop", payout.address);

    const m = await registry.merchantOf(shop.address);
    expect(m.name).to.equal("Corner Shop");
    expect(m.payoutAddress).to.equal(payout.address);
    expect(m.metadataURI).to.equal("ipfs://shop");
    expect(m.registeredAt).to.be.greaterThan(0n);
    expect(await registry.merchantCount()).to.equal(1n);
    expect(await registry.merchantAt(0)).to.equal(shop.address);
    // The merchant never needed a unit of MON.
    expect(await ethers.provider.getBalance(shop.address)).to.equal(0n);
  });

  it("they start inactive with the default cap", async () => {
    const shop = gaslessWallet();
    await registry.connect(operator).registerFor(shop.address, "Corner Shop", payout.address, "");
    await registry.connect(merchant).register("Self Serve", merchant.address, "");

    const viaOperator = await registry.merchantOf(shop.address);
    const selfRegistered = await registry.merchantOf(merchant.address);
    expect(viaOperator.active).to.equal(false);
    expect(viaOperator.maxOrderValue).to.equal(AUSD(500));
    expect(viaOperator.maxOrderValue).to.equal(await registry.DEFAULT_MAX_ORDER_VALUE());
    // Identical to what the merchant would have given themselves.
    expect(viaOperator.active).to.equal(selfRegistered.active);
    expect(viaOperator.maxOrderValue).to.equal(selfRegistered.maxOrderValue);
    expect(viaOperator.totalSettled).to.equal(0n);

    expect(await registry.canOriginate(shop.address, 1n)).to.equal(false);
  });

  it("the owner can register a merchant without appointing itself an operator", async () => {
    const shop = gaslessWallet();
    expect(await registry.isOperator(owner.address)).to.equal(false);
    await expect(registry.registerFor(shop.address, "Owner Onboarded", payout.address, ""))
      .to.emit(registry, "MerchantRegistered")
      .withArgs(shop.address, "Owner Onboarded", payout.address);
  });

  it("a stranger cannot register someone else", async () => {
    const shop = gaslessWallet();
    await expect(
      registry.connect(stranger).registerFor(shop.address, "Squatted", stranger.address, "")
    ).to.be.revertedWithCustomError(registry, "NotOperator");

    // Nor can a merchant register another merchant.
    await registry.connect(merchant).register("Shop", merchant.address, "");
    await expect(
      registry.connect(merchant).registerFor(shop.address, "Squatted", merchant.address, "")
    ).to.be.revertedWithCustomError(registry, "NotOperator");

    expect((await registry.merchantOf(shop.address)).registeredAt).to.equal(0n);
  });

  it("the same merchant cannot be registered twice by either path", async () => {
    // Self first, then the operator.
    await registry.connect(merchant).register("Shop", merchant.address, "");
    await expect(
      registry.connect(operator).registerFor(merchant.address, "Overwrite", stranger.address, "")
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");

    // Operator first, then self.
    await registry.connect(operator).registerFor(stranger.address, "Shop", stranger.address, "");
    await expect(
      registry.connect(stranger).register("Overwrite", merchant.address, "")
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");

    // Operator twice, and the owner after an operator.
    await expect(
      registry.connect(operator).registerFor(stranger.address, "Again", merchant.address, "")
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    await expect(
      registry.registerFor(stranger.address, "Again", merchant.address, "")
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");

    // Nothing was overwritten, and the list holds each merchant once.
    expect((await registry.merchantOf(merchant.address)).payoutAddress).to.equal(merchant.address);
    expect((await registry.merchantOf(stranger.address)).payoutAddress).to.equal(stranger.address);
    expect(await registry.merchantCount()).to.equal(2n);
  });

  it("revoking an operator stops it", async () => {
    await expect(registry.setOperator(operator.address, false))
      .to.emit(registry, "OperatorSet")
      .withArgs(operator.address, false);
    expect(await registry.isOperator(operator.address)).to.equal(false);

    await expect(
      registry.connect(operator).registerFor(gaslessWallet().address, "Late", payout.address, "")
    ).to.be.revertedWithCustomError(registry, "NotOperator");
  });

  it("only the owner decides who is an operator", async () => {
    await expect(
      registry.connect(stranger).setOperator(stranger.address, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    await expect(
      registry.connect(operator).setOperator(stranger.address, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    await expect(registry.setOperator(stranger.address, true))
      .to.emit(registry, "OperatorSet")
      .withArgs(stranger.address, true);
  });

  it("an operator cannot activate or raise the cap of a merchant it registered", async () => {
    const shop = gaslessWallet();
    await registry.connect(operator).registerFor(shop.address, "Shop", payout.address, "");

    await expect(
      registry.connect(operator).setActive(shop.address, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    await expect(
      registry.connect(operator).setMaxOrderValue(shop.address, AUSD(1_000_000))
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    await expect(
      registry.connect(operator).recordSettlement(shop.address, AUSD(1))
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("only the merchant's own key changes the payout address after the platform registers them", async () => {
    await registry.connect(operator).registerFor(merchant.address, "Shop", payout.address, "");

    // The operator has no hold over where the merchant is paid.
    await expect(
      registry.connect(operator).updatePayoutAddress(operator.address)
    ).to.be.revertedWithCustomError(registry, "NotRegistered");

    await registry.connect(merchant).updatePayoutAddress(merchant.address);
    expect((await registry.merchantOf(merchant.address)).payoutAddress).to.equal(merchant.address);
  });

  it("refuses to register the zero address", async () => {
    await expect(
      registry.connect(operator).registerFor(ethers.ZeroAddress, "Nobody", payout.address, "")
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    expect(await registry.merchantCount()).to.equal(0n);
  });

  it("an operator-registered merchant is gated by the engine exactly like a self-registered one", async () => {
    const [, , , , , borrower] = await ethers.getSigners();
    const ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
    const scores = await (await ethers.getContractFactory("ScoreManager")).deploy(owner.address);
    const engine = await (
      await ethers.getContractFactory("PolarisLoanEngine")
    ).deploy(
      owner.address,
      await ausd.getAddress(),
      await scores.getAddress(),
      owner.address,
      0,
      0
    );
    await scores.setWriter(await engine.getAddress(), true);
    await engine.setOriginator(owner.address, true);
    await engine.setMerchantRegistry(await registry.getAddress());
    await ausd.mint(owner.address, AUSD(10_000));
    await ausd.approve(await engine.getAddress(), AUSD(10_000));
    await engine.fund(AUSD(10_000));
    await ausd.mint(borrower.address, AUSD(1_000));
    await ausd.connect(borrower).approve(await engine.getAddress(), AUSD(1_000));

    const shop = gaslessWallet();
    await registry.connect(operator).registerFor(shop.address, "Shop", shop.address, "");

    // Registered, not yet activated: no plan can open against it.
    await expect(
      engine.createLoan(borrower.address, shop.address, AUSD(100), 4, 14 * DAY)
    ).to.be.revertedWithCustomError(engine, "MerchantNotEligible");

    await registry.setActive(shop.address, true);
    await engine.createLoan(borrower.address, shop.address, AUSD(100), 4, 14 * DAY);
    // Paid up front, into a wallet that has still never held MON.
    expect(await ausd.balanceOf(shop.address)).to.equal(AUSD(100));
    expect(await ethers.provider.getBalance(shop.address)).to.equal(0n);

    // And the default cap holds.
    await expect(
      engine.createLoan(borrower.address, shop.address, AUSD(501), 4, 14 * DAY)
    ).to.be.revertedWithCustomError(engine, "MerchantNotEligible");
  });
});
