/**
 * lib/redeploy.js `redeployVault` (scripts/redeploy-vault.js,
 * `redeploy-vault:monad`): replacing the CollateralVault Monad testnet runs
 * (built at the deploy commit, no `lockWithPermit`) with today's, and nothing
 * else. The deploy commit's vault is rebuilt from git and put in a local
 * deployment's place, as it is on testnet; then it is replaced, a borrower
 * secures a line without sending a transaction, and the deployment is read
 * back.
 */
const { expect } = require("chai");
const { execFileSync } = require("node:child_process");
const hre = require("hardhat");
const { ethers } = hre;

const { deployPolaris, USD } = require("../../lib/deploy");
const { checkDeployment } = require("../../lib/check");
const { redeployVault, runsTodaysVault } = require("../../lib/redeploy");
const { compileFor, repoRoot, standardInputAt } = require("../../lib/verify");
const { signPermit } = require("../helpers/sign");

const DEPLOY_COMMIT = "020484b2aea74bde3f2cbc918d534dbda1348723";
const FQN = "contracts/CollateralVault.sol:CollateralVault";

function haveCommit(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repoRoot() });
    return true;
  } catch {
    return false;
  }
}

describe("redeploy-vault (lib/redeploy.js)", function () {
  this.timeout(300_000);
  let record, deployer, transmitter, borrower, stranger;

  before(function () {
    if (!haveCommit(DEPLOY_COMMIT)) this.skip();
  });

  beforeEach(async () => {
    [deployer, , transmitter, borrower, stranger] = await ethers.getSigners();
    record = await deployPolaris(hre, {
      tokenMode: "mock",
      treasury: deployer.address,
      graceSeconds: 120,
      minInterval: 60,
      minPeriod: 60,
      forwarderKind: "local",
      simulationTransmitter: transmitter.address,
      demoMerchant: ethers.Wallet.createRandom(),
      poolSeed: USD(10_000),
    });
    // What Monad testnet runs: the deploy commit's CollateralVault, wired in.
    const { input, solcVersion } = await standardInputAt(hre, FQN, DEPLOY_COMMIT);
    const old = await compileFor(hre, input, solcVersion, FQN);
    const legacy = await new ethers.ContractFactory(old.abi, old.bytecode, deployer).deploy(deployer.address, record.contracts.Stablecoin.address);
    const address = await legacy.getAddress();
    const engine = await ethers.getContractAt("PolarisLoanEngine", record.contracts.PolarisLoanEngine.address);
    const scores = await ethers.getContractAt("ScoreManager", record.contracts.ScoreManager.address);
    await (await legacy.setLoanEngine(record.contracts.PolarisLoanEngine.address)).wait();
    await (await legacy.setSeizer(record.contracts.PolarisLoanEngine.address, true)).wait();
    await (await scores.setCollateralVault(address)).wait();
    await (await engine.setCollateralVault(address)).wait();
    record.contracts.CollateralVault = { ...record.contracts.CollateralVault, address, sourceCommit: DEPLOY_COMMIT };
    expect(await runsTodaysVault(hre, address)).to.equal(false);
  });

  it("deploys today's vault, points ScoreManager and the loan engine at it, and a borrower secures a line gas-free", async () => {
    const old = record.contracts.CollateralVault.address;
    const { record: next, txs } = await redeployVault(hre, record, { why: "test", allowDirty: true });
    const address = next.contracts.CollateralVault.address;
    expect(address).to.not.equal(old);
    expect(await runsTodaysVault(hre, address)).to.equal(true);
    expect(txs.map((t) => t.call)).to.deep.equal([
      "deploy",
      `setLoanEngine(${next.contracts.PolarisLoanEngine.address})`,
      `setSeizer(${next.contracts.PolarisLoanEngine.address}, true)`,
      `setCollateralVault(${address})`,
      `setCollateralVault(${address})`,
    ]);

    const scores = await ethers.getContractAt("ScoreManager", next.contracts.ScoreManager.address);
    const engine = await ethers.getContractAt("PolarisLoanEngine", next.contracts.PolarisLoanEngine.address);
    const vault = await ethers.getContractAt("CollateralVault", address);
    expect(await scores.collateralVault()).to.equal(address);
    expect(await engine.collateralVault()).to.equal(address);
    expect(await vault.loanEngine()).to.equal(next.contracts.PolarisLoanEngine.address);
    expect(await vault.isSeizer(next.contracts.PolarisLoanEngine.address)).to.equal(true);
    expect(await vault.owner()).to.equal(deployer.address);
    expect(await vault.creditMultiplierBps()).to.equal(15_000n);

    // A borrower with no MON: the permit is carried by someone else, and the line is secured.
    const token = await ethers.getContractAt("MockAUSD", next.contracts.Stablecoin.address);
    await (await token.mint(borrower.address, USD(300))).wait();
    const nonce = await ethers.provider.getTransactionCount(borrower.address);
    const p = await signPermit(token, borrower, address, USD(202));
    await (await vault.connect(stranger).lockWithPermit(borrower.address, USD(202), p.deadline, p.v, p.r, p.s)).wait();
    expect(await vault.lockedOf(borrower.address)).to.equal(USD(202));
    expect(await scores.creditLimitOf(borrower.address)).to.equal(USD(202));
    expect(await ethers.provider.getTransactionCount(borrower.address)).to.equal(nonce);

    expect(next.contracts.CollateralVault.sourceCommit).to.match(/^[0-9a-f]{40}$/);
    expect(next.contracts.CollateralVault.abi).to.equal("abi/CollateralVault.json");
    expect(next.redeploys.at(-1)).to.include({ contract: "CollateralVault", address, why: "test" });
    expect(next.redeploys.at(-1).replaced).to.include({ address: old, sourceCommit: DEPLOY_COMMIT });
    expect(record.contracts.CollateralVault.address).to.equal(old);

    const failed = (await checkDeployment(ethers, next)).filter((r) => !r.ok).map((r) => r.what);
    expect(failed).to.deep.equal([]);

    let err;
    try {
      await redeployVault(hre, next, { allowDirty: true });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/already runs today's code/);
  });

  it("refuses a signer who does not own the loan engine and ScoreManager, before sending anything", async () => {
    const asStranger = { ...hre, ethers: { ...ethers, getSigners: async () => [stranger] } };
    const nonce = await ethers.provider.getTransactionCount(stranger.address);
    let err;
    try {
      await redeployVault(asStranger, record, { allowDirty: true });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/is owned by/);
    expect(await ethers.provider.getTransactionCount(stranger.address)).to.equal(nonce);
  });
});
