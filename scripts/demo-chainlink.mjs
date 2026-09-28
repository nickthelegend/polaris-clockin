#!/usr/bin/env node
/**
 * The Chainlink CRE states of the product, on `pnpm demo:local` (a local
 * Hardhat chain; it refuses anything else):
 *
 *   node scripts/demo-chainlink.mjs <step>
 *
 *   buyer          a buyer key for this run (.demo/chainlink.json), with test
 *                  dollars (MockAUSD) and local gas; and a block every second
 *                  from now on, so the local chain's clock moves like a real one
 *   underwrite     the buyer's consent and a history wallet's link proof,
 *                  POST /api/credit/underwrite: the API fires trigger:local,
 *                  which runs the real polaris-underwrite handler on the CRE
 *                  SDK's test runtime (fixture personas) and writes the report
 *                  through the local forwarder; waits for the line
 *   plan           a Halcyon order for Pay in 4 (the shop's POST /api/checkout),
 *                  signed as the app signs it and carried by POST /api/relay
 *   lose-approval  the buyer sets its approval to the loan engine to 0 (its own
 *                  transaction): the next collection fails for a lost approval
 *   collect        a collections report for CollectionsReceiver.dueTasksFor(buyer)
 *   watch-retry    waits for PolarisCheckout.Reauthorized, then delivers the
 *                  same report at once: what the collections workflow's EVM log
 *                  trigger does on a real network
 *   guard max-age <seconds>
 *                  the owner sets how old an attestation may get before it is
 *                  stale (GuardianReceiver.setMaxAttestationAge; 3600 by default),
 *                  so a recording can show a late guard failing open in minutes
 *   guard healthy|depeg|stale
 *                  a guardian attestation from the local stand-in AUSD/USD feed
 *                  and PolarisLoanEngine.poolState(): healthy ($0.9998), a
 *                  depeg ($0.99, credit pauses), or one observed 59 minutes ago
 *                  (the guard goes stale a minute later and fails open)
 *   status         the buyer's plans and the guard, from the API
 *
 * HAND-BUILT REPORTS. On this local chain, `collect`, `watch-retry` and
 * `guard` build each report here (packages/contracts lib/cre.js, the same
 * encoders the contract tests hold the workflows to) and deliver it through
 * the local MockKeystoneForwarder from the deployer, which the receivers
 * accept as the local simulation transmitter. They stand in for the
 * collections and guardian workflows; no CRE workflow, DON or Chainlink feed
 * produced them. On Monad testnet the same reports come from
 * `cre workflow simulate --broadcast` (workflows/README.md).
 *
 * Reads .demo/demo.json and .demo/deployment.json, written by demo:local.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DEMO = join(REPO, ".demo");
const STATE = join(DEMO, "chainlink.json");
const BUSINESS = join(REPO, "apps", "business");
const CONTRACTS = join(REPO, "packages", "contracts");

// Hardhat's well-known first account: the local deployer, MockAUSD minter and CRE simulation transmitter.
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const fileUrl = (p) => pathToFileURL(p).href;
const requireBusiness = createRequire(join(BUSINESS, "package.json"));
const viem = await import(fileUrl(requireBusiness.resolve("viem")));
const accounts = await import(fileUrl(requireBusiness.resolve("viem/accounts")));
const abis = await import(fileUrl(join(CONTRACTS, "abi", "index.mjs")));
const cre = createRequire(join(CONTRACTS, "package.json"))("./lib/cre.js");

if (!existsSync(join(DEMO, "demo.json"))) throw new Error("Run `pnpm demo:local` first: .demo/demo.json is missing.");
const demo = JSON.parse(readFileSync(join(DEMO, "demo.json"), "utf8"));
const deployment = JSON.parse(readFileSync(join(DEMO, "deployment.json"), "utf8"));
const RPC = demo.urls.rpc;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(RPC) || ![31337, 1337].includes(deployment.chainId)) {
  throw new Error(`Local chains only (got ${RPC}, chain ${deployment.chainId}).`);
}
const API = demo.urls.business;
const SHOP = demo.urls.shop;
const at = (name) => viem.getAddress(deployment.contracts[name].address);
const chain = viem.defineChain({ id: deployment.chainId, name: "Local Hardhat", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const reader = viem.createPublicClient({ chain, transport: viem.http(RPC) });
const owner = viem.createWalletClient({ account: accounts.privateKeyToAccount(OWNER_KEY), chain, transport: viem.http(RPC) });

const log = (msg) => console.log(`[chainlink] ${msg}`);

function state() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
function save(next) {
  writeFileSync(STATE, JSON.stringify({ ...state(), ...next }, null, 2));
}
function buyer() {
  const s = state();
  if (!s.buyerKey) throw new Error("No buyer yet: run `node scripts/demo-chainlink.mjs buyer` first.");
  return accounts.privateKeyToAccount(s.buyerKey);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json", origin: demo.urls.app } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(payload?.error ?? payload)}`);
  return payload.data;
}

async function send(hash) {
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

/** Deliver a hand-built report through the local forwarder, as the local simulation transmitter. */
async function report(receiver, body, workflowName) {
  const block = await reader.getBlock();
  const raw = cre.encodeRawReport({
    body,
    workflowName,
    workflowOwner: owner.account.address,
    executionId: viem.keccak256(viem.toHex(`${workflowName}:${Date.now()}:${Math.random()}`)),
    timestamp: Number(block.timestamp),
  });
  const forwarder = viem.getAddress(deployment.cre.forwarder);
  const hash = await owner.writeContract({ address: forwarder, abi: abis.mockKeystoneForwarderAbi, functionName: "report", args: [receiver, raw, "0x", []] });
  const receipt = await send(hash);
  const processed = viem.parseEventLogs({ abi: abis.mockKeystoneForwarderAbi, logs: receipt.logs, eventName: "ReportProcessed" })[0];
  if (!processed?.args.result) throw new Error(`the receiver refused the report (tx ${hash})`);
  return hash;
}

/* ── Steps ─────────────────────────────────────────────────────────────── */

async function stepBuyer() {
  // A block a second, as a real chain makes them (Monad: every 400 ms), so the chain's clock moves on its own:
  // instalments fall due (dueTasksFor) and the guard's attestation ages (isStale) without anyone sending a transaction.
  await reader.request({ method: "evm_setIntervalMining", params: [1000] });
  const key = state().buyerKey ?? accounts.generatePrivateKey();
  const account = accounts.privateKeyToAccount(key);
  save({ buyerKey: key });
  await send(await owner.writeContract({ address: at("Stablecoin"), abi: abis.mockAUSDAbi, functionName: "mint", args: [account.address, 500_000_000n] }));
  await reader.request({ method: "hardhat_setBalance", params: [account.address, "0x8AC7230489E80000"] });
  log(`buyer ${account.address}: $500.00 of test dollars and local gas`);
  log("the key is in .demo/chainlink.json (git-ignored): store it as the app's dev signer, localStorage[\"polaris.dev-signer.v1\"] = { privateKey, createdAt }, to be this buyer");
}

async function stepUnderwrite() {
  const account = buyer();
  // A second wallet the buyer brings as history ("Raise your limit"): trigger:local gives it the "strong" fixture persona.
  let historyKey = state().historyKey;
  if (!historyKey) {
    historyKey = accounts.generatePrivateKey();
    save({ historyKey });
  }
  const wallet = accounts.privateKeyToAccount(historyKey);
  const m = await api(`/api/public/credit/${account.address}/messages?wallet=${wallet.address}`);
  const consent = { issuedAt: m.issuedAt, nonce: m.nonce, signature: await account.signMessage({ message: m.consent }) };
  const linked = { wallet: wallet.address, issuedAt: m.issuedAt, nonce: m.nonce, signature: await wallet.signMessage({ message: m.link }) };
  await api("/api/credit/underwrite", { method: "POST", body: { account: account.address, consent, linked } });
  log("underwriting queued; trigger:local runs the polaris-underwrite handler…");
  for (let i = 0; i < 90; i++) {
    const s = await api(`/api/public/credit/${account.address}`);
    if (s.decision) {
      log(`decision: ${s.decision.status}${s.decision.reason ? ` (${s.decision.reason})` : ""}, line $${s.onChain?.creditLimit ?? "?"}, report ${s.decision.txHash ?? "none"}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("no decision after 3 minutes: see .demo/logs/cre-trigger.log");
}

async function stepPlan() {
  const account = buyer();
  const res = await fetch(`${SHOP}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `chainlink-demo-${Date.now()}` },
    body: JSON.stringify({
      items: [{ productId: "halcyon-one", optionId: "graphite", quantity: 1 }],
      contact: { email: "lena.hartmann@example.com" },
      address: { name: "Lena Hartmann", line1: "Torstraße 118", city: "Berlin", postalCode: "10119", country: "Germany" },
      payment: { method: "polaris", mode: "later" },
    }),
  });
  const order = await res.json();
  if (!res.ok) throw new Error(`shop checkout: ${res.status} ${JSON.stringify(order)}`);
  const sessionId = order.checkout.sessionId;
  const [session, network] = await Promise.all([api(`/api/public/sessions/${sessionId}?buyer=${account.address}`), api("/api/public/network")]);
  if (!session.payIn4?.available) throw new Error(`Pay in 4 isn't available: ${session.payIn4?.reason}`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const intent = {
    buyer: account.address,
    merchant: session.chain.merchant,
    principal: BigInt(session.chain.amountUnits),
    installments: session.payIn4.installments,
    interval: BigInt(session.payIn4.intervalSeconds),
    orderId: session.chain.orderId,
    nonce: BigInt(session.buyer.checkoutNonce),
    deadline: now + 900n,
  };
  const types = createRequire(join(CONTRACTS, "package.json"))("./lib/eip712.js").TYPES;
  const signature = await account.signTypedData({ domain: network.domains.checkout, types: { PlanIntent: types.PolarisCheckout.PlanIntent }, primaryType: "PlanIntent", message: intent });
  const permit = { owner: account.address, spender: network.contracts.loanEngine, value: BigInt(session.buyer.quote.permitValue), nonce: BigInt(session.buyer.tokenNonce), deadline: now + 1800n };
  const permitSignature = await account.signTypedData({ domain: network.domains.stablecoin, types: { Permit: types.Stablecoin.Permit }, primaryType: "Permit", message: permit });
  const out = await api("/api/relay", {
    method: "POST",
    body: {
      type: "openPlan",
      sessionId,
      intent: { buyer: intent.buyer, principal: String(intent.principal), installments: String(intent.installments), interval: String(intent.interval), nonce: String(intent.nonce), deadline: String(intent.deadline) },
      signature,
      permit: { value: String(permit.value), deadline: String(permit.deadline), signature: permitSignature },
    },
  });
  log(`plan ${out.planId} opened for order ${order.order.number} (tx ${out.txHash}); payment 1 is due in ${session.payIn4.intervalSeconds} s`);
}

async function stepLoseApproval() {
  const account = buyer();
  const wallet = viem.createWalletClient({ account, chain, transport: viem.http(RPC) });
  const hash = await wallet.writeContract({ address: at("Stablecoin"), abi: abis.mockAUSDAbi, functionName: "approve", args: [at("PolarisLoanEngine"), 0n] });
  await send(hash);
  log(`approval to the loan engine set to 0 by the buyer (tx ${hash})`);
}

async function dueTasks(borrower) {
  return reader.readContract({ address: at("CollectionsReceiver"), abi: abis.collectionsReceiverAbi, functionName: "dueTasksFor", args: [borrower] });
}

async function stepCollect() {
  const tasks = await dueTasks(buyer().address);
  if (tasks.length === 0) throw new Error("nothing is due for the buyer yet (wait for the interval)");
  const hash = await report(at("CollectionsReceiver"), cre.encodeCollectionsReport(tasks.map((t) => ({ action: Number(t.action), id: t.id }))), cre.WORKFLOW_NAMES.COLLECTIONS);
  log(`collections report (hand-built) for ${tasks.length} task(s): tx ${hash}`);
}

async function stepWatchRetry() {
  const account = buyer();
  const from = await reader.getBlockNumber();
  log(`waiting for Reauthorized from ${account.address} (sign again in the app)…`);
  for (;;) {
    const logs = await reader.getContractEvents({ address: at("PolarisCheckout"), abi: abis.polarisCheckoutAbi, eventName: "Reauthorized", args: { buyer: account.address }, fromBlock: from });
    if (logs.length) {
      log(`Reauthorized in tx ${logs[0].transactionHash}`);
      await stepCollect();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function stepGuard(kind) {
  const guardian = at("GuardianReceiver");
  const feed = at("MockAusdUsdFeed");
  const price = kind === "depeg" ? 99_000_000n : 99_980_000n;
  const block = await reader.getBlock();
  const observedAt = kind === "stale" ? block.timestamp - 3540n : block.timestamp;
  await send(await owner.writeContract({ address: feed, abi: abis.mockPriceFeedAbi, functionName: "setRound", args: [price, observedAt - 60n] }));
  const [roundId, answer, , updatedAt] = await reader.readContract({ address: feed, abi: abis.mockPriceFeedAbi, functionName: "latestRoundData" });
  const [pool, thresholds] = await reader.readContract({ address: guardian, abi: abis.guardianReceiverAbi, functionName: "currentInputs" });
  const a = cre.buildAttestation({ price: answer, priceRoundId: roundId, priceUpdatedAt: updatedAt, pool, observedAt }, thresholds);
  const hash = await report(guardian, cre.encodeGuardianReport(a), cre.WORKFLOW_NAMES.GUARDIAN);
  log(`guardian attestation (hand-built, local stand-in feed at $${(Number(price) / 1e8).toFixed(4)}${kind === "stale" ? ", observed 59 min ago" : ""}): tx ${hash}`);
}

async function stepMaxAge(seconds) {
  const age = Number(seconds);
  if (!Number.isInteger(age) || age < 1 || age > 604_800) throw new Error("max-age takes 1 to 604800 seconds");
  const hash = await owner.writeContract({ address: at("GuardianReceiver"), abi: abis.guardianReceiverAbi, functionName: "setMaxAttestationAge", args: [age] });
  await send(hash);
  log(`guardian maxAttestationAge set to ${age} s by the owner (tx ${hash})`);
}

async function stepStatus() {
  const account = buyer();
  const [book, guard] = await Promise.all([api(`/api/public/buyers/${account.address}`), api("/api/public/credit-guard")]);
  for (const p of book.plans) log(`plan ${p.id}: ${p.state}, ${p.installmentsPaid}/${p.installments} paid, needsSignature ${p.needsSignature}, reauthorized ${JSON.stringify(p.reauthorized)}`);
  log(`guard: ${guard.state}${guard.paused ? ` (${guard.reasons.join(", ")})` : ""}, last checked ${guard.ageSeconds ?? "never"} s ago`);
}

const [step, arg, value] = process.argv.slice(2);
const steps = {
  buyer: stepBuyer,
  underwrite: stepUnderwrite,
  plan: stepPlan,
  "lose-approval": stepLoseApproval,
  collect: stepCollect,
  "watch-retry": stepWatchRetry,
  guard: () => (arg === "max-age" ? stepMaxAge(value) : stepGuard(arg)),
  status: stepStatus,
};
if (!steps[step] || (step === "guard" && !["healthy", "depeg", "stale", "max-age"].includes(arg))) {
  console.error("Usage: node scripts/demo-chainlink.mjs buyer | underwrite | plan | lose-approval | collect | watch-retry | guard healthy|depeg|stale | guard max-age <seconds> | status");
  process.exit(2);
}
await steps[step]();
