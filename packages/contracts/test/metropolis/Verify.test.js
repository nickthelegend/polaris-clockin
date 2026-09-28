/**
 * lib/verify.js: verifying a contract whose sources moved on after it was
 * deployed. PolarisCheckout on Monad testnet was built at the deploy commit;
 * reauthorize has changed since, so today's sources no longer reproduce it
 * and hardhat-verify would refuse it. The deploy commit's sources, read from
 * git, must reproduce it exactly (the executable code; Etherscan ignores the
 * metadata), and today's must not.
 */
const { expect } = require("chai");
const { execFileSync } = require("node:child_process");
const hre = require("hardhat");
const { ethers } = hre;

const {
  compileFor,
  headSource,
  repoRoot,
  sameExecutable,
  sourcesFor,
  sourcesUnchangedSince,
  standardInputAt,
  withoutMetadata,
  zeroImmutables,
} = require("../../lib/verify");

/** The commit deploy:monad built every contract on Monad testnet from (28 Sep 2026). */
const DEPLOY_COMMIT = "020484b2aea74bde3f2cbc918d534dbda1348723";
const CHECKOUT = "contracts/PolarisCheckout.sol:PolarisCheckout";

function haveCommit(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repoRoot() });
    return true;
  } catch {
    return false;
  }
}

describe("verifying a contract built from an earlier commit (lib/verify.js)", function () {
  this.timeout(300_000);

  it("compares code as Etherscan does: immutables zeroed, metadata left out", () => {
    // 6 bytes of code, then 4 bytes of CBOR metadata and its length (0x0004).
    const code = "0x60806040526011aabbccdd0004";
    expect(withoutMetadata(code)).to.equal("60806040526011");
    expect(zeroImmutables("0x6080604052ff", { 1: [{ start: 5, length: 1 }] })).to.equal("608060405200");
    const refs = { 7: [{ start: 1, length: 2 }] };
    expect(sameExecutable("0x61abcd00" + "11220002", "0x61000000" + "33440002", refs)).to.equal(true);
    expect(sameExecutable("0x62abcd00" + "11220002", "0x61000000" + "33440002", refs)).to.equal(false);
    expect(sameExecutable("0x", "0x6080", {})).to.equal(false);
  });

  it("rebuilds PolarisCheckout as deployed on Monad testnet from git, and tells it from today's", async function () {
    if (!haveCommit(DEPLOY_COMMIT)) this.skip();
    expect(sourcesUnchangedSince(DEPLOY_COMMIT)).to.equal(false, "reauthorize has changed since the deploy");
    const { input, solcVersion, solcLongVersion } = await standardInputAt(hre, CHECKOUT, DEPLOY_COMMIT);
    expect(solcLongVersion).to.match(/^0\.8\.\d+\+commit\./);
    expect(input.sources["contracts/PolarisCheckout.sol"].content).to.not.include("reauthorizedThrough");
    const old = await compileFor(hre, input, solcVersion, CHECKOUT);

    // The deploy commit's PolarisCheckout, deployed here as deploy:monad did it.
    const [owner, treasury] = await ethers.getSigners();
    const ausd = await (await ethers.getContractFactory("MockAUSD")).deploy();
    const scores = await (await ethers.getContractFactory("ScoreManager")).deploy(owner.address);
    const engine = await (await ethers.getContractFactory("PolarisLoanEngine")).deploy(owner.address, ausd, scores, treasury.address, 3600, 60);
    const payments = await (await ethers.getContractFactory("PolarisPayments")).deploy(owner.address, ausd, treasury.address, 60);
    const args = [owner.address, await engine.getAddress(), await payments.getAddress(), await scores.getAddress()];
    const deployed = await new ethers.ContractFactory(old.abi, old.bytecode, owner).deploy(...args);
    const today = await (await ethers.getContractFactory("PolarisCheckout")).deploy(...args);

    // Its code is the deploy commit's build, not today's.
    const onChain = await ethers.provider.getCode(await deployed.getAddress());
    expect(sameExecutable(onChain, old.deployedBytecode, old.immutableReferences)).to.equal(true);
    const artifact = await hre.artifacts.readArtifact(CHECKOUT);
    expect(sameExecutable(onChain, artifact.deployedBytecode, old.immutableReferences)).to.equal(false);

    // So verify-monad submits the deploy commit's sources for it, and today's for a current deployment.
    const found = await sourcesFor(hre, { fqn: CHECKOUT, address: await deployed.getAddress(), commit: DEPLOY_COMMIT });
    expect(found.from).to.equal(DEPLOY_COMMIT);
    expect(found.input.sources["contracts/PolarisCheckout.sol"].content).to.equal(input.sources["contracts/PolarisCheckout.sol"].content);
    expect((await sourcesFor(hre, { fqn: CHECKOUT, address: await today.getAddress(), commit: DEPLOY_COMMIT })).from).to.equal("today");
    let err;
    try {
      await sourcesFor(hre, { fqn: CHECKOUT, address: await deployed.getAddress(), commit: null });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/names no sourceCommit/);
  });

  it("knows the commit it is at, and whether the contracts are committed", () => {
    const { commit, dirty } = headSource();
    expect(commit).to.match(/^[0-9a-f]{40}$/);
    expect(typeof dirty).to.equal("boolean");
  });
});
