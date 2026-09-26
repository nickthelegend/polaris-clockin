/**
 * lib/deploy.js, run in-process exactly as scripts/deploy-monad.js runs it on
 * Monad testnet (with MockAUSD and a local forwarder in place of AUSD and
 * Chainlink's). Every role the protocol depends on is checked here, so a
 * deployment cannot come out with the checkout unable to originate, the
 * receiver unable to underwrite, or anyone but the checkout able to open a
 * plan.
 */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const { deployPolaris, USD } = require("../../lib/deploy");
const cre = require("../../lib/cre");

describe("deploy-monad (in process)", () => {
  let record, deployer, relayer, merchant;
  const at = (name) => ethers.getContractAt(name, record.contracts[name].address);

  before(async () => {
    [deployer, relayer] = await ethers.getSigners();
    merchant = ethers.Wallet.createRandom();
    record = await deployPolaris(hre, {
      tokenMode: "mock",
      treasury: deployer.address,
      graceSeconds: 120,
      minInterval: 60,
      minPeriod: 60,
      forwarderKind: "local",
      simulationTransmitter: deployer.address,
      relayer: relayer.address,
      demoMerchant: merchant,
      poolSeed: USD(100_000),
    });
  });

  it("records every contract with its address, block, transaction and an ABI that exists", async () => {
    const names = [
      "Stablecoin", "ScoreManager", "PolarisLoanEngine", "PolarisPayments", "MerchantRegistry", "CollateralVault",
      "BatchSettlement", "PolarisSend", "PolarisCheckout", "MockKeystoneForwarder", "CollectionsReceiver", "UnderwritingReceiver",
    ];
    expect(Object.keys(record.contracts)).to.have.members(names);
    for (const n of names) {
      const c = record.contracts[n];
      expect(ethers.isAddress(c.address), n).to.equal(true);
      expect(await ethers.provider.getCode(c.address), n).to.not.equal("0x");
      expect(c.blockNumber, n).to.be.a("number");
      expect(c.txHash, n).to.match(/^0x[0-9a-f]{64}$/);
      expect(existsSync(join(__dirname, "..", "..", c.abi)), `${n} ${c.abi}`).to.equal(true);
    }
    expect(record.chainId).to.equal(31337);
  });

  it("makes PolarisCheckout the only originator, and the payments' only checkout", async () => {
    const engine = await at("PolarisLoanEngine");
    expect(await engine.isOriginator(record.contracts.PolarisCheckout.address)).to.equal(true);
    for (const who of [deployer.address, relayer.address, record.contracts.CollectionsReceiver.address]) {
      expect(await engine.isOriginator(who)).to.equal(false);
    }
    expect(await (await at("PolarisPayments")).checkout()).to.equal(record.contracts.PolarisCheckout.address);
    expect(record.roles.loanEngineOriginators).to.deep.equal([record.contracts.PolarisCheckout.address]);
  });

  it("lets only the engine write scores and only the underwriting receiver underwrite, and requires underwriting", async () => {
    const scores = await at("ScoreManager");
    expect(await scores.isWriter(record.contracts.PolarisLoanEngine.address)).to.equal(true);
    expect(await scores.isWriter(deployer.address)).to.equal(false);
    expect(await scores.isUnderwriter(record.contracts.UnderwritingReceiver.address)).to.equal(true);
    expect(await scores.isUnderwriter(deployer.address)).to.equal(false);
    expect(await scores.isUnderwriter(record.contracts.CollectionsReceiver.address)).to.equal(false);
    expect(await scores.requireUnderwriting()).to.equal(true);
    expect(await scores.collateralVault()).to.equal(record.contracts.CollateralVault.address);
  });

  it("wires the vault, the registry and the CRE receivers to the forwarder", async () => {
    const vault = await at("CollateralVault");
    const engine = await at("PolarisLoanEngine");
    expect(await vault.loanEngine()).to.equal(record.contracts.PolarisLoanEngine.address);
    expect(await vault.isSeizer(record.contracts.PolarisLoanEngine.address)).to.equal(true);
    expect(await engine.collateralVault()).to.equal(record.contracts.CollateralVault.address);
    expect(await engine.merchantRegistry()).to.equal(record.contracts.MerchantRegistry.address);
    for (const r of ["CollectionsReceiver", "UnderwritingReceiver"]) {
      expect(await (await at(r)).getForwarderAddress()).to.equal(record.contracts.MockKeystoneForwarder.address);
    }
    expect(await (await at("UnderwritingReceiver")).simulationTransmitter()).to.equal(deployer.address);
    expect(record.cre.workflows.collections.nameBytes10).to.equal(cre.workflowNameBytes10("polaris-collections"));
  });

  it("gives the relayer its operator roles and nothing that moves money", async () => {
    expect(await (await at("PolarisPayments")).isOperator(relayer.address)).to.equal(true);
    expect(await (await at("MerchantRegistry")).isOperator(relayer.address)).to.equal(true);
    expect(await (await at("BatchSettlement")).isSettler(relayer.address)).to.equal(true);
    expect(await (await at("PolarisLoanEngine")).isOriginator(relayer.address)).to.equal(false);
    expect(await (await at("PolarisLoanEngine")).owner()).to.equal(deployer.address);
  });

  it("registers the demo merchant by its own signature, activates it, and publishes its plans", async () => {
    const m = await (await at("MerchantRegistry")).merchantOf(merchant.address);
    expect(m.name).to.equal("Polaris Demo Studio");
    expect(m.payoutAddress).to.equal(merchant.address);
    expect(m.active).to.equal(true);
    expect(m.maxOrderValue).to.equal(USD(1_000));
    const payments = await at("PolarisPayments");
    for (const p of record.demo.subscriptionPlans) {
      const plan = await payments.getPlan(p.planId);
      expect(plan.merchant).to.equal(merchant.address);
      expect(plan.pricePerPeriod.toString()).to.equal(p.pricePerPeriod);
      expect(plan.periodSeconds.toString()).to.equal(p.periodSeconds);
    }
  });

  it("seeds the credit pool", async () => {
    const token = await ethers.getContractAt("MockAUSD", record.contracts.Stablecoin.address);
    expect(await token.balanceOf(record.contracts.PolarisLoanEngine.address)).to.equal(USD(100_000));
    expect(record.demo.poolSeeded).to.equal(USD(100_000).toString());
  });

  it("publishes the EIP-712 domains clients sign under", async () => {
    expect(record.eip712.PolarisCheckout.domain).to.deep.equal({
      name: "PolarisCheckout",
      version: "1",
      chainId: 31337,
      verifyingContract: record.contracts.PolarisCheckout.address,
    });
    expect(record.eip712.Stablecoin.domain.name).to.equal("Agora Dollar");
    expect(record.eip712.PolarisCheckout.types.PlanIntent.map((f) => f.name)).to.deep.equal([
      "buyer", "merchant", "principal", "installments", "interval", "orderId", "nonce", "deadline",
    ]);
    // Everything in the record serialises.
    expect(() => JSON.stringify(record, (_, v) => (typeof v === "bigint" ? v.toString() : v))).to.not.throw();
  });
});
