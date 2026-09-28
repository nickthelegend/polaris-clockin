/**
 * lib/check.js, the read-back that check:deployment:monad runs after a deploy:
 * every row passes on a deployment exactly as lib/deploy.js leaves it, and the
 * rows that matter fail when the chain stops agreeing with the record.
 */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const { deployPolaris, USD } = require("../../lib/deploy");
const { checkDeployment } = require("../../lib/check");

describe("check-deployment (lib/check.js)", () => {
  let record, deployer, relayer, transmitter;
  const at = (name) => ethers.getContractAt(name, record.contracts[name].address);
  const failed = (rows) => rows.filter((r) => !r.ok).map((r) => r.what);

  beforeEach(async () => {
    [deployer, relayer, transmitter] = await ethers.getSigners();
    record = await deployPolaris(hre, {
      tokenMode: "mock",
      treasury: deployer.address,
      graceSeconds: 120,
      minInterval: 60,
      minPeriod: 60,
      forwarderKind: "local",
      simulationTransmitter: transmitter.address,
      relayer: relayer.address,
      demoMerchant: ethers.Wallet.createRandom(),
      poolSeed: USD(10_000),
    });
  });

  it("passes every row on a fresh deployment, and reports the guardian and the pool", async () => {
    const rows = await checkDeployment(ethers, record);
    expect(failed(rows)).to.deep.equal([]);
    expect(rows.length).to.be.greaterThan(40);
    expect(rows.find((r) => r.what === "guardian status (info)").detail).to.equal("no attestation yet; Pay in 4 open");
    expect(rows.find((r) => r.what === "credit pool (info)").detail).to.equal("10000.0 held by the loan engine");
    expect(rows.find((r) => r.what === "Stablecoin: the mock says it is one (ERC-20 name \"Mock AUSD\")").ok).to.equal(true);
  });

  it("fails when the checkout loses its credit guard or a receiver its transmitter", async () => {
    await (await at("PolarisCheckout")).setCreditGuardian(ethers.ZeroAddress);
    await (await at("UnderwritingReceiver")).setSimulationTransmitter(deployer.address);
    expect(failed(await checkDeployment(ethers, record))).to.have.members([
      "PolarisCheckout: credit guardian is GuardianReceiver",
      "UnderwritingReceiver: simulation transmitter matches the record",
    ]);
  });

  it("fails a simulation deployment whose transmitter is the deployer", async () => {
    const simulated = { ...record, cre: { ...record.cre, forwarderKind: "simulation", simulationTransmitter: deployer.address } };
    for (const n of ["CollectionsReceiver", "UnderwritingReceiver", "GuardianReceiver"]) {
      await (await at(n)).setSimulationTransmitter(deployer.address);
    }
    expect(failed(await checkDeployment(ethers, simulated))).to.have.members([
      "CollectionsReceiver: simulation transmitter is set and is not the deployer",
      "UnderwritingReceiver: simulation transmitter is set and is not the deployer",
      "GuardianReceiver: simulation transmitter is set and is not the deployer",
    ]);
  });

  it("fails an address with no code, a wrong chain and changed thresholds", async () => {
    const guardian = await at("GuardianReceiver");
    await guardian.setThresholds({ minPrice: 100_000_000n, minFreeCash: USD(1_000), maxBadDebtBps: 500, maxPriceAge: 7_200 });
    const broken = {
      ...record,
      chainId: 10143,
      contracts: { ...record.contracts, PolarisSend: { ...record.contracts.PolarisSend, address: ethers.Wallet.createRandom().address } },
    };
    expect(failed(await checkDeployment(ethers, broken))).to.have.members([
      "chain id matches the record",
      "PolarisSend has code",
      "GuardianReceiver: thresholds match the record",
    ]);
  });

  it("fails when the relayer is given the power to originate", async () => {
    await (await at("PolarisLoanEngine")).setOriginator(relayer.address, true);
    expect(failed(await checkDeployment(ethers, record))).to.deep.equal(["relayer: does not originate loans"]);
  });
});
