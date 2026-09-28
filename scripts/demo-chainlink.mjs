#!/usr/bin/env node
/**
 * The Chainlink CRE scenes of the product, on a running `pnpm demo:local`
 * (a local Hardhat chain; it refuses anything else):
 *
 *   node scripts/demo-chainlink.mjs <step>
 *
 *   buyer          a buyer key for this run (.demo/chainlink.json), with test
 *                  dollars (MockAUSD) and local gas
 *   underwrite     the buyer's consent and a history wallet's link proof,
 *                  POST /api/credit/underwrite: the API fires trigger:local,
 *                  which runs the real polaris-underwrite handler on the CRE
 *                  SDK's test runtime (fixture personas) and writes the report
 *                  through the local forwarder; waits for the line
 *   plan           a Halcyon order for Pay in 4 (the shop's POST /api/checkout),
 *                  signed as the app signs it and carried by POST /api/relay
 *   lose-approval  the buyer sets its approval to the loan engine to 0 (its
 *                  own transaction, as a wallet's "revoke" would): the next
 *                  collection of a due instalment fails for a lost approval,
 *                  and the plan asks the buyer to sign again
 *   guard raise [price]
 *                  THE DEMO THRESHOLD. The owner raises GuardianReceiver's
 *                  depeg threshold (minPrice) above the real AUSD/USD price
 *                  (default $1.001; Chainlink's feed reads about $0.9998), so
 *                  the guardian's next run pauses new Pay in 4 plans. The
 *                  price is never faked; the bar is moved, and every caption
 *                  says "threshold raised for demo". Waits for the pause.
 *   guard restore  the thresholds from before `raise` (else the deploy
 *                  defaults); waits for the guardian's next run to resume
 *   guard max-age <seconds>
 *                  how old an attestation may get before it is stale and
 *                  credit fails open (GuardianReceiver.setMaxAttestationAge;
 *                  3600 by default)
 *   guard status   GuardianReceiver.creditStatus() and thresholds()
 *   status         the buyer's plans and the guard, from the API
 *
 * Every report in these scenes comes from a real workflow handler run by
 * demo:local's local runners (workflows/scripts local-collections.mjs,
 * local-guardian.mjs, local-trigger.mjs): the collections cron and its
 * Reauthorized log trigger, and the guardian's cron. This script only does
 * what a person would: the owner's settings, the buyer's own transactions,
 * and the API calls the apps make. On Monad testnet the same reports come
 * from `cre workflow simulate --broadcast` (workflows/README.md).
 *
 * DEMO_BUYER_KEY overrides the buyer (e.g. the app's dev signer key, so the
 * browser's buyer is the one who loses the approval).
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

// Hardhat's well-known first account: the local deployer, the owner of every contract, and MockAUSD's minter.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dollars = (price8) => `$${(Number(price8) / 1e8).toFixed(4)}`;

function state() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
function save(next) {
  writeFileSync(STATE, JSON.stringify({ ...state(), ...next }, null, 2));
}
function buyer() {
  const key = process.env.DEMO_BUYER_KEY || state().buyerKey;
  if (!key) throw new Error("No buyer yet: run `node scripts/demo-chainlink.mjs buyer` first, or set DEMO_BUYER_KEY.");
  return accounts.privateKeyToAccount(key);
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

/* ── The buyer ─────────────────────────────────────────────────────────── */

async function gas(address) {
  await reader.request({ method: "hardhat_setBalance", params: [address, "0x8AC7230489E80000"] });
}

async function stepBuyer() {
  const key = state().buyerKey ?? accounts.generatePrivateKey();
  const account = accounts.privateKeyToAccount(key);
  save({ buyerKey: key });
  await send(await owner.writeContract({ address: at("Stablecoin"), abi: abis.mockAUSDAbi, functionName: "mint", args: [account.address, 500_000_000n] }));
  await gas(account.address);
  log(`buyer ${account.address}: $500.00 of test dollars and local gas`);
  log('the key is in .demo/chainlink.json (git-ignored): store it as the app\'s dev signer, localStorage["polaris.dev-signer.v1"] = { privateKey, createdAt }, to be this buyer');
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
    await sleep(2000);
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
  await gas(account.address);
  const wallet = viem.createWalletClient({ account, chain, transport: viem.http(RPC) });
  const hash = await wallet.writeContract({ address: at("Stablecoin"), abi: abis.mockAUSDAbi, functionName: "approve", args: [at("PolarisLoanEngine"), 0n] });
  await send(hash);
  log(`the buyer ${account.address} set its approval to the loan engine to 0 (tx ${hash}): the next due instalment's collection fails, and the plan asks to sign again`);
}

/* ── The guard ─────────────────────────────────────────────────────────── */

const guardian = () => at("GuardianReceiver");

async function thresholdsNow() {
  const t = await reader.readContract({ address: guardian(), abi: abis.guardianReceiverAbi, functionName: "thresholds" });
  return { minPrice: t.minPrice, minFreeCash: t.minFreeCash, maxBadDebtBps: Number(t.maxBadDebtBps), maxPriceAge: Number(t.maxPriceAge) };
}

async function creditStatus() {
  const s = await reader.readContract({ address: guardian(), abi: abis.guardianReceiverAbi, functionName: "creditStatus" });
  return { ...s, round: s.round, observedAt: Number(s.observedAt) };
}

async function setThresholds(t) {
  const hash = await owner.writeContract({ address: guardian(), abi: abis.guardianReceiverAbi, functionName: "setThresholds", args: [t] });
  await send(hash);
  return hash;
}

/** Wait for the guardian's next run to land an attestation whose verdict is `paused`. */
async function waitForVerdict(paused, fromRound) {
  const started = Date.now();
  for (;;) {
    const s = await creditStatus();
    if (s.round > fromRound && s.attestedPaused === paused) return s;
    if (Date.now() - started > 180_000) throw new Error(`no ${paused ? "pausing" : "resuming"} attestation in 3 minutes: see .demo/logs/cre-guardian.log`);
    await sleep(2000);
  }
}

function lastGuardianRun() {
  try {
    return JSON.parse(readFileSync(demo.guardian?.status ?? join(DEMO, "guardian.json"), "utf8"));
  } catch {
    return null;
  }
}

async function stepGuardRaise(priceArg) {
  const min = viem.parseUnits(priceArg ?? "1.001", 8);
  const before = await thresholdsNow();
  if (!state().thresholdsBefore) save({ thresholdsBefore: { ...before, minPrice: String(before.minPrice), minFreeCash: String(before.minFreeCash) } });
  const { round } = await creditStatus();
  const hash = await setThresholds({ ...before, minPrice: min });
  const run = lastGuardianRun();
  const price = run?.result?.price;
  log(`THRESHOLD RAISED FOR DEMO: the owner set the depeg threshold to ${dollars(min)} (was ${dollars(before.minPrice)}) in tx ${hash}`);
  if (price) log(`the guardian's last read: ${price.kind === "chainlink" ? "Chainlink" : "the local mock"} ${price.description} ${price.answer} (round ${price.roundId}); the price is not touched`);
  log("waiting for the guardian's next scheduled run…");
  const s = await waitForVerdict(true, round);
  log(`the guardian attested round ${s.round}: Pay in 4 paused (${reasonWords(s.attestedReasons).join(", ")})`);
}

async function stepGuardRestore() {
  const saved = state().thresholdsBefore;
  const t = saved
    ? { minPrice: BigInt(saved.minPrice), minFreeCash: BigInt(saved.minFreeCash), maxBadDebtBps: saved.maxBadDebtBps, maxPriceAge: saved.maxPriceAge }
    : { minPrice: cre.GUARDIAN_DEFAULTS.minPrice, minFreeCash: cre.GUARDIAN_DEFAULTS.minFreeCash, maxBadDebtBps: cre.GUARDIAN_DEFAULTS.maxBadDebtBps, maxPriceAge: cre.GUARDIAN_DEFAULTS.maxPriceAge };
  const { round } = await creditStatus();
  const hash = await setThresholds(t);
  save({ thresholdsBefore: null });
  log(`the owner restored the depeg threshold to ${dollars(t.minPrice)} in tx ${hash}; waiting for the guardian's next scheduled run…`);
  const s = await waitForVerdict(false, round);
  log(`the guardian attested round ${s.round}: healthy, Pay in 4 resumed`);
}

async function stepMaxAge(seconds) {
  const age = Number(seconds);
  if (!Number.isInteger(age) || age < 1 || age > 604_800) throw new Error("max-age takes 1 to 604800 seconds");
  const hash = await owner.writeContract({ address: guardian(), abi: abis.guardianReceiverAbi, functionName: "setMaxAttestationAge", args: [age] });
  await send(hash);
  log(`guardian maxAttestationAge set to ${age} s by the owner (tx ${hash})`);
}

function reasonWords(mask) {
  const names = { 1: "depeg", 2: "low free cash", 4: "bad debt", 8: "stale price", 128: "owner pause" };
  return Object.entries(names)
    .filter(([bit]) => (mask & Number(bit)) !== 0)
    .map(([, w]) => w);
}

async function stepGuardStatus() {
  const [s, t] = await Promise.all([creditStatus(), thresholdsNow()]);
  log(`openPlan: ${s.paused ? `paused (${reasonWords(s.reasons).join(", ")})` : "open"}; attested round ${s.round} ${s.attestedPaused ? "paused" : "healthy"}${s.stale ? ", STALE (fails open)" : ""}; override ${["none", "resume", "pause"][s.overrideMode]}`);
  log(`thresholds: depeg below ${dollars(t.minPrice)}, free cash under $${(Number(t.minFreeCash) / 1e6).toLocaleString("en-US")}, bad debt over ${t.maxBadDebtBps / 100}% of originations, price older than ${t.maxPriceAge / 3600} h`);
  const run = lastGuardianRun();
  if (run) log(`last run ${run.at}: ${run.result.status} (${run.result.why}), price ${run.result.price.kind} ${run.result.price.answer}`);
}

async function stepStatus() {
  const account = buyer();
  const [book, guard] = await Promise.all([api(`/api/public/buyers/${account.address}`), api("/api/public/credit-guard")]);
  for (const p of book.plans) log(`plan ${p.id}: ${p.state}, ${p.installmentsPaid}/${p.installments} paid, needsSignature ${p.needsSignature}, reauthorized ${JSON.stringify(p.reauthorized)}`);
  log(`guard: ${guard.state}${guard.paused ? ` (${guard.reasons.join(", ")})` : ""}, last checked ${guard.ageSeconds ?? "never"} s ago`);
}

const [step, arg, value] = process.argv.slice(2);
const guardSteps = { raise: () => stepGuardRaise(value), restore: stepGuardRestore, "max-age": () => stepMaxAge(value), status: stepGuardStatus };
const steps = {
  buyer: stepBuyer,
  underwrite: stepUnderwrite,
  plan: stepPlan,
  "lose-approval": stepLoseApproval,
  guard: () => guardSteps[arg](),
  status: stepStatus,
};
if (!steps[step] || (step === "guard" && !guardSteps[arg])) {
  console.error("Usage: node scripts/demo-chainlink.mjs buyer | underwrite | plan | lose-approval | guard raise [price] | guard restore | guard max-age <seconds> | guard status | status");
  process.exit(2);
}
await steps[step]();
