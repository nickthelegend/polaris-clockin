/**
 * Verify every contract in deployments/monad-testnet.json on Monadscan, through
 * the Etherscan V2 API (Monad testnet is on its free tier).
 *
 *   ETHERSCAN_API_KEY=... pnpm --filter @polarispay/contracts verify:monad
 *
 * Constructor arguments are rebuilt from the deployment record. Already
 * verified contracts are reported and skipped.
 */

"use strict";

const hre = require("hardhat");
const d = require("../deployments/monad-testnet.json");

function constructorArgs() {
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
    CollectionsReceiver: [d.cre.forwarder, c("PolarisLoanEngine"), c("PolarisPayments")],
    UnderwritingReceiver: [d.cre.forwarder, c("ScoreManager"), d.cre.simulationTransmitter],
    ...(d.contracts.Stablecoin.kind === "MockAUSD" ? { Stablecoin: [] } : {}),
  };
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("Set ETHERSCAN_API_KEY (an Etherscan V2 key).");
  for (const [name, args] of Object.entries(constructorArgs())) {
    const address = d.contracts[name].address;
    const contract = name === "Stablecoin" ? "contracts/MockAUSD.sol:MockAUSD" : undefined;
    try {
      await hre.run("verify:verify", { address, constructorArguments: args, contract });
      console.log(`verified ${name} ${address}`);
    } catch (e) {
      const msg = e.message ?? String(e);
      console.log(`${/already verified/i.test(msg) ? "already verified" : "FAILED"} ${name} ${address}${/already verified/i.test(msg) ? "" : `: ${msg}`}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
