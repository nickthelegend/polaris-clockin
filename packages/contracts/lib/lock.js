/**
 * Lock the three CRE receivers to the Polaris workflows once they are
 * deployed: the workflow owner, name AND id (ReceiverTemplate's three identity
 * checks), then the production forwarder, then clear the simulation
 * transmitter. Used by scripts/lock-receivers.js (`lock-receivers:monad`) and
 * test/metropolis/LockReceivers.test.js.
 *
 * Why a separate step: a workflow's id exists only once `cre workflow deploy`
 * has run, long after the contracts are deployed, and while the receivers sit
 * behind Chainlink's simulation forwarder (a public contract anyone can call)
 * the transmitter guard is what keeps forged reports out. So the transmitter
 * is cleared only when moving to the production KeystoneForwarder, which
 * checks the DON's signatures, and only after the identity checks are set.
 * If this stops half way, the receivers refuse reports rather than accept
 * them: the production forwarder's transmitting node is never the simulation
 * transmitter.
 *
 * Idempotent: it reads each setting first and sends only what differs.
 */

"use strict";

const { ZeroAddress, getAddress, isHexString, ZeroHash } = require("ethers");

const tx = require("./tx");
const { WORKFLOW_NAMES, workflowNameBytes10 } = require("./cre");

/** The receivers, their workflow's key in deployments' `cre.workflows`, and its name. */
const RECEIVERS = [
  { contract: "CollectionsReceiver", workflow: "collections", name: WORKFLOW_NAMES.COLLECTIONS, idEnv: "CRE_WORKFLOW_ID_COLLECTIONS" },
  { contract: "UnderwritingReceiver", workflow: "underwrite", name: WORKFLOW_NAMES.UNDERWRITING, idEnv: "CRE_WORKFLOW_ID_UNDERWRITE" },
  { contract: "GuardianReceiver", workflow: "guardian", name: WORKFLOW_NAMES.GUARDIAN, idEnv: "CRE_WORKFLOW_ID_GUARDIAN" },
];

/**
 * @param {object} hre
 * @param {object} record            a deployment record (deployments/*.json)
 * @param {object} opts
 * @param {string} opts.workflowOwner the CRE workflow owner address
 * @param {Record<string,string>} opts.workflowIds  receiver contract name -> bytes32 workflow id;
 *                                    receivers without one are left untouched
 * @param {"production"|"simulation"} opts.forwarderKind
 *                                    production: switch to `forwarderAddress` and clear the
 *                                    transmitter; simulation: keep the forwarder and transmitter
 * @param {string} [opts.forwarderAddress] required for production
 * @returns {Promise<object>} what each receiver now accepts, with the transactions sent
 */
async function lockReceivers(hre, record, opts, log = () => {}) {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();
  const workflowOwner = getAddress(opts.workflowOwner ?? "");
  if (workflowOwner === ZeroAddress) throw new Error("workflowOwner must be the CRE workflow owner, not zero");
  if (!["production", "simulation"].includes(opts.forwarderKind)) {
    throw new Error('forwarderKind must be "production" or "simulation"');
  }
  const production = opts.forwarderKind === "production";
  const forwarder = production ? getAddress(opts.forwarderAddress ?? "") : null;
  if (production && forwarder === ZeroAddress) throw new Error("the production forwarder address is required");

  const targets = RECEIVERS.filter((r) => opts.workflowIds?.[r.contract]);
  if (targets.length === 0) throw new Error("no workflow id given: nothing to lock");
  for (const r of targets) {
    const id = opts.workflowIds[r.contract];
    if (!isHexString(id, 32) || id === ZeroHash) throw new Error(`${r.contract}: workflow id must be a non-zero bytes32, got ${id}`);
    if (!record.contracts[r.contract]) throw new Error(`${r.contract} is not in the deployment record`);
  }

  const out = { at: new Date().toISOString(), workflowOwner, forwarderKind: opts.forwarderKind, receivers: {} };
  for (const r of targets) {
    const receiver = await ethers.getContractAt(r.contract, record.contracts[r.contract].address, owner);
    const id = opts.workflowIds[r.contract].toLowerCase();
    const nameBytes10 = workflowNameBytes10(r.name);
    const sent = [];
    const send = async (method, args, why) => {
      const receipt = await tx.send(receiver, method, args);
      sent.push({ method, args: args.map(String), txHash: receipt.hash });
      log(`  ${r.contract.padEnd(21)} ${why}  (${receipt.hash})`);
    };

    // Identity first, while the transmitter guard still stands.
    if ((await receiver.getExpectedAuthor()) !== workflowOwner) await send("setExpectedAuthor", [workflowOwner], `author ${workflowOwner}`);
    if ((await receiver.getExpectedWorkflowName()) !== nameBytes10) await send("setExpectedWorkflowName", [r.name], `name ${r.name}`);
    if ((await receiver.getExpectedWorkflowId()).toLowerCase() !== id) await send("setExpectedWorkflowId", [id], `id ${id}`);
    if (production) {
      if ((await receiver.getForwarderAddress()) !== forwarder) await send("setForwarderAddress", [forwarder], `forwarder ${forwarder}`);
      if ((await receiver.simulationTransmitter()) !== ZeroAddress) await send("setSimulationTransmitter", [ZeroAddress], "simulation transmitter cleared");
    }
    if (sent.length === 0) log(`  ${r.contract.padEnd(21)} already locked`);

    out.receivers[r.contract] = {
      workflow: r.workflow,
      name: r.name,
      nameBytes10,
      workflowId: id,
      author: await receiver.getExpectedAuthor(),
      forwarder: await receiver.getForwarderAddress(),
      simulationTransmitter: await receiver.simulationTransmitter(),
      txs: sent,
    };
  }
  return out;
}

/** Fold a lock result into a deployment record (what scripts/lock-receivers.js writes). */
function applyLock(record, lock) {
  record.cre.locked = lock;
  record.cre.workflowOwner = lock.workflowOwner;
  const all = Object.values(lock.receivers);
  if (lock.forwarderKind === "production" && all.length === RECEIVERS.length) {
    record.cre.forwarderKind = "production";
    record.cre.forwarder = all[0].forwarder;
    record.cre.simulationTransmitter = ZeroAddress;
  }
  for (const r of all) {
    const w = record.cre.workflows?.[r.workflow];
    if (w) w.workflowId = r.workflowId;
  }
  return record;
}

module.exports = { RECEIVERS, lockReceivers, applyLock };
