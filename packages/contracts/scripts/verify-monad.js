/**
 * Verify every contract in deployments/monad-testnet.json on Monadscan, through
 * the Etherscan V2 API (Monad testnet is on its free tier).
 *
 *   ETHERSCAN_API_KEY=... pnpm --filter @polarispay/contracts verify:monad
 *   VERIFY_DRY_RUN=1 pnpm --filter @polarispay/contracts verify:monad    # no key: which sources reproduce each contract
 *   VERIFY_ONLY=PolarisCheckout,GuardianReceiver ...                     # some of them
 *
 * For each contract, the sources that built it: today's when they reproduce
 * the code on chain (hardhat-verify), else those of the commit the record
 * names for it (`sourceCommit`, per contract or for the whole record),
 * rebuilt from git and checked to reproduce the code before they are sent
 * (lib/verify.js). So a contract fixed in code since it was deployed (and not
 * redeployed) still verifies as what is on chain. Constructor arguments come
 * from the record. Already verified contracts are reported and skipped.
 * Reads the chain; sends no transaction.
 */

"use strict";

const hre = require("hardhat");
const { Etherscan } = require("@nomicfoundation/hardhat-verify/etherscan");

const d = require("../deployments/monad-testnet.json");
const { sourcesFor } = require("../lib/verify");

/**
 * Each contract's constructor arguments: as the deployment recorded them
 * (`args`), or rebuilt from the record for one written before it kept them.
 */
function constructorArgs() {
  const recorded = Object.fromEntries(
    Object.entries(d.contracts)
      .filter(([name, c]) => Array.isArray(c.args) && !(name === "Stablecoin" && c.kind !== "MockAUSD"))
      .map(([name, c]) => [name, c.args])
  );
  return { ...rebuiltArgs(), ...recorded };
}

function rebuiltArgs() {
  const c = (name) => d.contracts[name]?.address;
  const owner = d.deployer;
  const token = c("Stablecoin");
  return {
    ScoreManager: [owner],
    PolarisLoanEngine: [owner, token, c("ScoreManager"), d.config.treasury, d.config.graceSeconds, d.config.minInterval],
    PolarisPayments: [owner, token, d.config.treasury, d.config.minPeriod],
    MerchantRegistry: [owner],
    CollateralVault: [owner, token],
    BatchSettlement: [owner, token],
    PolarisSend: [token],
    PolarisCheckout: [owner, c("PolarisLoanEngine"), c("PolarisPayments"), c("ScoreManager")],
    CollectionsReceiver: [d.cre.forwarder, c("PolarisLoanEngine"), c("PolarisPayments"), d.cre.simulationTransmitter],
    UnderwritingReceiver: [d.cre.forwarder, c("ScoreManager"), d.cre.simulationTransmitter],
    ...(d.contracts.Stablecoin.kind === "MockAUSD" ? { Stablecoin: [] } : {}),
  };
}

/** The record's contract name as the artifact that built it ("contracts/cre/GuardianReceiver.sol:GuardianReceiver"). */
async function fqnOf(name) {
  const artifactName = name === "Stablecoin" ? "MockAUSD" : name;
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return `${artifact.sourceName}:${artifact.contractName}`;
}

/** Etherscan V2 for Monad testnet, from hardhat.config.js's customChains. */
function etherscanClient(apiKey) {
  const chain = hre.config.etherscan.customChains.find((c) => c.network === "monadTestnet");
  return new Etherscan(apiKey, chain.urls.apiURL, chain.urls.browserURL, chain.chainId);
}

/** Submit `found.input` (an earlier commit's sources) as standard JSON, and wait for the answer. */
async function submitFromCommit(etherscan, { name, fqn, address, args, found }) {
  if (await etherscan.isVerified(address)) return "already verified";
  const encoded = new hre.ethers.Interface(found.abi).encodeDeploy(args).slice(2);
  const sent = await etherscan.verify(address, JSON.stringify(found.input), fqn, `v${found.solcLongVersion}`, encoded);
  const status = await etherscan.getVerificationStatus(sent.message);
  if (!status.isSuccess()) throw new Error(`${name}: ${status.message}`);
  return `verified from ${found.from.slice(0, 10)}'s sources`;
}

async function main() {
  const dryRun = process.env.VERIFY_DRY_RUN === "1";
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!dryRun && !apiKey) throw new Error("Set ETHERSCAN_API_KEY (an Etherscan V2 key), or VERIFY_DRY_RUN=1 to only check the sources.");
  const { chainId } = await hre.ethers.provider.getNetwork();
  if (Number(chainId) !== Number(d.chainId)) throw new Error(`The record is for chain ${d.chainId}; this network is ${chainId}.`);
  const only = process.env.VERIFY_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const etherscan = dryRun ? null : etherscanClient(apiKey);
  let failed = 0;

  for (const [name, args] of Object.entries(constructorArgs())) {
    const c = d.contracts[name];
    if (!c || (only && !only.includes(name))) continue;
    const fqn = await fqnOf(name);
    const commit = c.sourceCommit ?? d.sourceCommit ?? null;
    try {
      const found = await sourcesFor(hre, { fqn, address: c.address, commit });
      if (dryRun) {
        console.log(`ok       ${name.padEnd(21)} ${c.address}  ${found.from === "today" ? "today's sources" : `sources at ${found.from.slice(0, 10)}`}`);
        continue;
      }
      if (found.from === "today") {
        const contract = name === "Stablecoin" ? fqn : undefined;
        await hre.run("verify:verify", { address: c.address, constructorArguments: args, contract });
        console.log(`verified ${name} ${c.address}`);
      } else {
        console.log(`${await submitFromCommit(etherscan, { name, fqn, address: c.address, args, found })}: ${name} ${c.address}`);
      }
    } catch (e) {
      const msg = e.message ?? String(e);
      if (/already verified/i.test(msg)) {
        console.log(`already verified ${name} ${c.address}`);
      } else {
        failed++;
        console.log(`FAILED   ${name} ${c.address}: ${msg}`);
      }
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
