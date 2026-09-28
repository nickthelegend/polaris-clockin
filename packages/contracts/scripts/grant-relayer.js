/**
 * Give the relayer (the Privy server wallet) its operator roles on an existing
 * deployment, for when RELAYER_ADDRESS was not known at deploy time.
 *
 *   RELAYER_ADDRESS=0x... pnpm --filter @polarispay/contracts grant-relayer:monad
 *
 * Grants: PolarisPayments operator (quoteOrder, createPlanFor),
 * MerchantRegistry operator (registerFor), BatchSettlement settler. The relay
 * entry points themselves (PolarisCheckout, PolarisSend, repayWithSig, ...)
 * are permissionless and need no role: the users' signatures decide.
 */

"use strict";

const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const hre = require("hardhat");
const { getAddress } = require("ethers");
const { send } = require("../lib/tx");
const { deploymentFile } = require("./deploy-monad");

async function main() {
  if (!process.env.RELAYER_ADDRESS) throw new Error("Set RELAYER_ADDRESS to the relayer's address.");
  const relayer = getAddress(process.env.RELAYER_ADDRESS);
  const file = join(__dirname, "..", "deployments", deploymentFile(hre.network.name));
  const d = require(file);
  const at = (name) => hre.ethers.getContractAt(name, d.contracts[name].address);

  await send(await at("PolarisPayments"), "setOperator", [relayer, true]);
  await send(await at("MerchantRegistry"), "setOperator", [relayer, true]);
  await send(await at("BatchSettlement"), "setSettler", [relayer, true]);

  // The relayer it replaces (the dev adapter's key, before the Privy server wallet) keeps its roles
  // until an owner revokes them; the record says so rather than forgetting it.
  if (d.roles.relayer && getAddress(d.roles.relayer) !== relayer) {
    d.roles.previousRelayers = [...new Set([...(d.roles.previousRelayers ?? []), getAddress(d.roles.relayer)])];
  }
  d.roles.relayer = relayer;
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`Relayer ${relayer}: PolarisPayments operator, MerchantRegistry operator, BatchSettlement settler.`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exitCode = 1;
});
