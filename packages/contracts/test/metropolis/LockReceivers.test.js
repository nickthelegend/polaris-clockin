/**
 * lib/lock.js (scripts/lock-receivers.js, `lock-receivers:monad`): after the
 * CRE workflows are deployed, each receiver accepts only its own workflow
 * (owner, name and id), then moves to the production forwarder and drops the
 * simulation transmitter, in that order.
 */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const { deployPolaris, USD } = require("../../lib/deploy");
const { lockReceivers, applyLock, RECEIVERS } = require("../../lib/lock");
const cre = require("../../lib/cre");

describe("lock-receivers (lib/lock.js)", () => {
  let record, deployer, workflowOwner, stranger, production;
  const ids = {
    CollectionsReceiver: ethers.id("polaris-collections deployed"),
    UnderwritingReceiver: ethers.id("polaris-underwrite deployed"),
    GuardianReceiver: ethers.id("polaris-guardian deployed"),
  };
  const at = (name) => ethers.getContractAt(name, record.contracts[name].address);

  beforeEach(async () => {
    [deployer, , , , workflowOwner, stranger] = await ethers.getSigners();
    record = await deployPolaris(hre, {
      tokenMode: "mock",
      treasury: deployer.address,
      graceSeconds: 120,
      minInterval: 60,
      minPeriod: 60,
      forwarderKind: "local",
      simulationTransmitter: deployer.address,
      demoMerchant: ethers.Wallet.createRandom(),
      poolSeed: USD(10_000),
    });
    // Stands in for Chainlink's production KeystoneForwarder on this local chain.
    production = await (await ethers.getContractFactory("MockKeystoneForwarder")).deploy();
  });

  async function deliver(forwarder, receiverName, body, { from = stranger, workflowId, owner = workflowOwner.address, name } = {}) {
    const raw = cre.encodeRawReport({
      body,
      workflowName: name,
      workflowOwner: owner,
      workflowId,
      executionId: ethers.hexlify(ethers.randomBytes(32)),
      timestamp: Math.floor(Date.now() / 1000),
    });
    await (await forwarder.connect(from).report(record.contracts[receiverName].address, raw, "0x", [])).wait();
    return { ok: (await forwarder.lastRevertData()) === "0x", revert: await forwarder.lastRevertData() };
  }

  it("locks every receiver to its workflow, then moves it to the production forwarder and clears the transmitter", async () => {
    const lock = await lockReceivers(hre, record, {
      workflowOwner: workflowOwner.address,
      workflowIds: ids,
      forwarderKind: "production",
      forwarderAddress: await production.getAddress(),
    });
    for (const r of RECEIVERS) {
      const c = await at(r.contract);
      expect(await c.getExpectedAuthor(), r.contract).to.equal(workflowOwner.address);
      expect(await c.getExpectedWorkflowName(), r.contract).to.equal(cre.workflowNameBytes10(r.name));
      expect(await c.getExpectedWorkflowId(), r.contract).to.equal(ids[r.contract]);
      expect(await c.getForwarderAddress(), r.contract).to.equal(await production.getAddress());
      expect(await c.simulationTransmitter(), r.contract).to.equal(ethers.ZeroAddress);
      const methods = lock.receivers[r.contract].txs.map((t) => t.method);
      expect(methods, r.contract).to.deep.equal([
        "setExpectedAuthor", "setExpectedWorkflowName", "setExpectedWorkflowId", "setForwarderAddress", "setSimulationTransmitter",
      ]);
    }

    // Behind the production forwarder any transmitting node may deliver, but only this workflow's reports land.
    const body = cre.encodeCollectionsReport([]);
    const collections = await at("CollectionsReceiver");
    const right = { workflowId: ids.CollectionsReceiver, name: cre.WORKFLOW_NAMES.COLLECTIONS };
    expect((await deliver(production, "CollectionsReceiver", body, right)).ok).to.equal(true);
    const wrongId = await deliver(production, "CollectionsReceiver", body, { ...right, workflowId: ids.GuardianReceiver });
    expect(collections.interface.parseError(wrongId.revert).name).to.equal("InvalidWorkflowId");
    const wrongOwner = await deliver(production, "CollectionsReceiver", body, { ...right, owner: stranger.address });
    expect(collections.interface.parseError(wrongOwner.revert).name).to.equal("InvalidAuthor");
    const oldForwarder = await ethers.getContractAt("MockKeystoneForwarder", record.contracts.MockKeystoneForwarder.address);
    const viaOld = await deliver(oldForwarder, "CollectionsReceiver", body, { ...right, from: deployer });
    expect(collections.interface.parseError(viaOld.revert).name).to.equal("InvalidSender");

    // The record says what now holds.
    applyLock(record, lock);
    expect(record.cre.forwarderKind).to.equal("production");
    expect(record.cre.forwarder).to.equal(await production.getAddress());
    expect(record.cre.simulationTransmitter).to.equal(ethers.ZeroAddress);
    expect(record.cre.workflows.guardian.workflowId).to.equal(ids.GuardianReceiver);
    expect(record.cre.locked.receivers.UnderwritingReceiver.workflowId).to.equal(ids.UnderwritingReceiver);
  });

  it("is idempotent: a second run sends nothing", async () => {
    const opts = { workflowOwner: workflowOwner.address, workflowIds: ids, forwarderKind: "production", forwarderAddress: await production.getAddress() };
    await lockReceivers(hre, record, opts);
    const nonce = await ethers.provider.getTransactionCount(deployer.address);
    const again = await lockReceivers(hre, record, opts);
    expect(await ethers.provider.getTransactionCount(deployer.address)).to.equal(nonce);
    for (const r of Object.values(again.receivers)) expect(r.txs).to.deep.equal([]);
  });

  it("while still simulating, adds the identity checks and keeps the forwarder and the transmitter guard", async () => {
    await lockReceivers(hre, record, { workflowOwner: workflowOwner.address, workflowIds: { GuardianReceiver: ids.GuardianReceiver }, forwarderKind: "simulation" });
    const guardian = await at("GuardianReceiver");
    expect(await guardian.getExpectedWorkflowId()).to.equal(ids.GuardianReceiver);
    expect(await guardian.getForwarderAddress()).to.equal(record.contracts.MockKeystoneForwarder.address);
    expect(await guardian.simulationTransmitter()).to.equal(deployer.address);
    // A receiver without an id is left exactly as it was.
    expect(await (await at("CollectionsReceiver")).getExpectedAuthor()).to.equal(ethers.ZeroAddress);
  });

  it("refuses to start without an owner, with a malformed id, with no ids, or without a production forwarder", async () => {
    const nonce = await ethers.provider.getTransactionCount(deployer.address);
    const base = { workflowOwner: workflowOwner.address, workflowIds: ids, forwarderKind: "production", forwarderAddress: await production.getAddress() };
    const bad = [
      [{ ...base, workflowOwner: ethers.ZeroAddress }, /workflowOwner/],
      [{ ...base, workflowIds: { ...ids, GuardianReceiver: "0x1234" } }, /bytes32/],
      [{ ...base, workflowIds: { ...ids, GuardianReceiver: ethers.ZeroHash } }, /non-zero/],
      [{ ...base, workflowIds: {} }, /nothing to lock/],
      [{ ...base, forwarderAddress: ethers.ZeroAddress }, /production forwarder/],
      [{ ...base, forwarderKind: "sideways" }, /forwarderKind/],
    ];
    for (const [opts, message] of bad) {
      let err;
      try {
        await lockReceivers(hre, record, opts);
      } catch (e) {
        err = e;
      }
      expect(err?.message, String(message)).to.match(message);
    }
    expect(await ethers.provider.getTransactionCount(deployer.address)).to.equal(nonce, "nothing was sent");
  });
});
