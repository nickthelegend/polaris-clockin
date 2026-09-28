/**
 * Replace one contract of a live deployment: GuardianReceiver, the only one
 * whose replacement touches nothing but PolarisCheckout's credit guard. Used
 * by scripts/redeploy-guardian.js (`redeploy-guardian:monad`) and
 * test/metropolis/Redeploy.test.js.
 *
 * It deploys the current GuardianReceiver against the record's own loan
 * engine, forwarder and simulation transmitter, points PolarisCheckout at it
 * (setCreditGuardian), and folds the result into the record: the contract's
 * entry (with the commit it was built from), roles.creditGuardian, the
 * guardian workflow's receiver, feed and view, config.guardian, and a
 * `redeploys` entry naming what it replaced. The old receiver stays on chain
 * with its rounds; nothing asks it any more.
 *
 * Refuses before sending anything when the signer is not the owner of
 * PolarisCheckout, or when the record's GuardianReceiver already runs today's
 * code (nothing to replace).
 */

"use strict";

const { getAddress } = require("ethers");

const tx = require("./tx");
const { guardianThresholds } = require("./cre");
const { GUARDIAN_VIEW, guardianRecordConfig, jsonSafe } = require("./deploy");
const { headSource, sameExecutable } = require("./verify");

const FQN = "contracts/cre/GuardianReceiver.sol:GuardianReceiver";

/** Whether the code at `address` is today's GuardianReceiver. */
async function runsTodaysGuardian(hre, address) {
  const artifact = await hre.artifacts.readArtifact(FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(FQN);
  const refs = buildInfo?.output?.contracts?.["contracts/cre/GuardianReceiver.sol"]?.GuardianReceiver?.evm?.deployedBytecode?.immutableReferences;
  return sameExecutable(await hre.ethers.provider.getCode(address), artifact.deployedBytecode, refs);
}

/**
 * @param {object} hre
 * @param {object} record   a deployment record (deployments/*.json); not mutated
 * @param {object} [opts]
 * @param {object} [opts.thresholds]        GuardianReceiver thresholds (lib/cre.js defaults for any unset)
 * @param {number} [opts.maxAttestationAge] seconds (the record's, else 3600)
 * @param {string} [opts.why]               kept in the record's `redeploys` entry
 * @param {boolean} [opts.allowDirty]       allow uncommitted contracts (tests); the record then says so
 * @returns {Promise<{ record: object, txs: object[] }>}
 */
async function redeployGuardian(hre, record, opts = {}, log = () => {}) {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();
  const old = record.contracts?.GuardianReceiver;
  const engine = record.contracts?.PolarisLoanEngine?.address;
  const checkoutAddress = record.contracts?.PolarisCheckout?.address;
  if (!old || !engine || !checkoutAddress) throw new Error("the record has no GuardianReceiver, PolarisLoanEngine or PolarisCheckout");
  const checkout = await ethers.getContractAt("PolarisCheckout", checkoutAddress, owner);
  const checkoutOwner = await checkout.owner();
  if (getAddress(checkoutOwner) !== owner.address) throw new Error(`PolarisCheckout is owned by ${checkoutOwner}, not the signer ${owner.address}`);
  if (await runsTodaysGuardian(hre, old.address)) throw new Error(`GuardianReceiver ${old.address} already runs today's code: nothing to replace`);
  const source = headSource();
  if (source.dirty && !opts.allowDirty) throw new Error("contracts/ has uncommitted changes: commit them first, so the record can name the commit this bytecode comes from");

  const forwarder = record.cre?.forwarder;
  const transmitter = record.cre?.simulationTransmitter ?? ethers.ZeroAddress;
  if (!forwarder) throw new Error("the record names no CRE forwarder");
  const thresholds = guardianThresholds(opts.thresholds ?? {});
  const maxAttestationAge = Number(opts.maxAttestationAge ?? record.config?.guardian?.maxAttestationAge ?? 3600);
  const args = [forwarder, engine, transmitter, thresholds, maxAttestationAge];

  const txs = [];
  const note = async (receipt, contract, call) => {
    const sent = await ethers.provider.getTransaction(receipt.hash);
    txs.push({ nonce: sent.nonce, block: receipt.blockNumber, hash: receipt.hash, contract, call });
  };

  log("GuardianReceiver (today's code)");
  const factory = await ethers.getContractFactory("GuardianReceiver", owner);
  const d = await tx.deploy(factory, args);
  await note(d.receipt, "create", "deploy");
  log(`  GuardianReceiver       ${d.address}  (block ${d.receipt.blockNumber}, gas ${d.receipt.gasUsed})`);
  const wired = await tx.send(checkout, "setCreditGuardian", [d.address]);
  await note(wired, "PolarisCheckout", `setCreditGuardian(${d.address})`);
  log(`  PolarisCheckout: credit guardian = ${d.address}  (${wired.hash})`);

  const next = JSON.parse(JSON.stringify(record));
  next.contracts.GuardianReceiver = {
    address: d.address,
    blockNumber: d.receipt.blockNumber,
    txHash: d.receipt.hash,
    gasUsed: d.receipt.gasUsed.toString(),
    abi: "abi/GuardianReceiver.json",
    args: jsonSafe(args),
    sourceCommit: source.commit,
    ...(source.dirty ? { sourceDirty: true } : {}),
  };
  next.roles = { ...next.roles, creditGuardian: d.address };
  next.config = { ...next.config, guardian: guardianRecordConfig(thresholds, maxAttestationAge) };
  const g = next.cre?.workflows?.guardian;
  if (g) {
    g.receiver = d.address;
    g.view = GUARDIAN_VIEW;
    if (g.feed) g.feed.address = d.address;
  }
  next.redeploys = [
    ...(next.redeploys ?? []),
    {
      at: new Date().toISOString(),
      contract: "GuardianReceiver",
      replaced: { address: old.address, txHash: old.txHash, sourceCommit: old.sourceCommit ?? record.sourceCommit ?? null },
      address: d.address,
      sourceCommit: source.commit,
      why: opts.why ?? null,
      txs,
    },
  ];
  return { record: next, txs };
}

module.exports = { redeployGuardian, runsTodaysGuardian };
