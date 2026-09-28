#!/usr/bin/env node
// Polaris for Business against the live Monad testnet deployment, end to end:
//
//   pnpm --filter @polaris/business smoke:testnet               # checks the setup, sends nothing
//   pnpm --filter @polaris/business smoke:testnet -- --run      # Pay now, Pay in 4, a lost approval signed again
//
//  1. reads packages/contracts/deployments/monad-testnet.json (refuses any
//     chain but Monad testnet, 10143) and two keys from the git-ignored
//     repo-root .env: DEPLOYER_PRIVATE_KEY (mints the MOCK dollar, which
//     anyone may mint, and gives the test buyer a few cents of MON for its
//     own three calls) and TESTNET_RELAYER_PRIVATE_KEY (the dev relayer the
//     deployment gave its operator roles; it stands in for the Privy relayer,
//     which does not exist yet). Keys are never printed;
//  2. starts Polaris for Business (next dev) on :3850 with RELAYER_MODE=local
//     and RELAYER_LOCAL_ALLOW_TESTNET=1, Privy forced off (nothing touches the
//     live Privy app), a fresh SQLite store, and the deployment's demo
//     merchant seeded with API keys and a webhook endpoint on :3851 that
//     verifies every delivery with polarispay-sdk;
//  3. a fresh buyer, who holds mock dollars:
//     - Pay now: a checkout session through polarispay-sdk, the buyer signs
//       ReceiveWithAuthorization, /api/relay sends PolarisCheckout.pay;
//     - Pay in 4: requireUnderwriting is on and an unsecured line needs the
//       CRE underwriting report, so the buyer's line here is secured: it
//       locks mock dollars in CollateralVault itself (its own two
//       transactions), then signs PlanIntent + Permit and /api/relay sends
//       PolarisCheckout.openPlan (the guardian is asked first: with no
//       attestation yet it fails open, by design);
//     - a lost approval: the buyer sets its approval to the loan engine to 0
//       itself, signs a fresh permit, and /api/relay sends
//       PolarisCheckout.reauthorize, whose Reauthorized log is what the CRE
//       collections workflow's EVM log trigger listens for;
//  4. checks each transaction on chain (sender, target, status, the events),
//     the webhooks (payment.succeeded, plan.opened), and writes every hash to
//     packages/contracts/deployments/monad-testnet.smoke.json.
//
// Instalments are a minute apart (--interval 60, the deployment's minimum,
// as DEMO_FAST_PLANS does), so the plan has instalments due by the time the
// CRE collections workflow runs: `pnpm --filter @polaris/cre-workflows
// evidence --retry-tx <the reauthorize hash>` collects them (--interval 604800
// gives the product's weekly plan instead).
//
// Ports: SMOKE_PORT (3850) and SMOKE_HOOK_PORT (3851).

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPublicClient, createWalletClient, defineChain, formatEther, formatUnits, getAddress, http, parseEther, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { collateralVaultAbi, mockAUSDAbi, polarisCheckoutAbi, polarisLoanEngineAbi, scoreManagerAbi } from "@polarispay/contracts/abi";
import { APP_DIR, REPO_DIR, flag, option, parseEnvFile } from "./privy/lib.mjs";
import { seedMerchant } from "./lib/seed.mjs";

const PORT = Number(process.env.SMOKE_PORT ?? 3850);
const HOOK_PORT = Number(process.env.SMOKE_HOOK_PORT ?? 3851);
const BASE = `http://localhost:${PORT}`;
const RECORD = join(REPO_DIR, "packages", "contracts", "deployments", "monad-testnet.json");
const OUT = join(REPO_DIR, "packages", "contracts", "deployments", "monad-testnet.smoke.json");
const SDK_DIR = join(REPO_DIR, "packages", "sdk");
const RPC = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const INTERVAL = Number(option("interval", "60"));
/** The most MON this script gives the throwaway buyer (three calls of its own). */
const BUYER_MON = parseEther("0.03");
const PLAN_USD = 200;
const PAY_NOW_USD = 25;

const children = [];
let work = null; // the server's SQLite store, made when the run starts
const steps = [];
let n = 0;

const log = (m) => console.log(m);
function pass(what, detail = "") {
  log(`  ${String(++n).padStart(2)}. PASS  ${what}${detail ? `  ${detail}` : ""}`);
}
function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

async function until(what, fn, { timeoutMs = 60_000, everyMs = 1000 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // not yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

function background(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  const lines = [];
  const keep = (b) => {
    for (const line of b.toString().split(/\r?\n/)) if (line.trim()) lines.push(line);
    if (lines.length > 200) lines.splice(0, lines.length - 200);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  children.push({ name, child, lines });
  return child;
}

async function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** The keys this run needs, from the environment or the git-ignored repo-root .env. Never printed. */
export function keysFrom(env) {
  const hex = (name) => {
    const v = env[name]?.trim();
    if (!v) return null;
    const k = v.startsWith("0x") ? v : `0x${v}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`${name} is not a 32-byte hex key`);
    return k;
  };
  return { deployer: hex("DEPLOYER_PRIVATE_KEY"), relayer: hex("TESTNET_RELAYER_PRIVATE_KEY") };
}

/** Everything that must hold before a transaction is sent: the reasons to refuse (empty when ready). */
export function preflight({ record, keys, relayerAddress, relayerBalance, deployerBalance, minRelayer, minDeployer }) {
  const problems = [];
  if (!record) return ["No packages/contracts/deployments/monad-testnet.json: run deploy:monad first."];
  if (Number(record.chainId) !== 10143) problems.push(`The record is for chain ${record.chainId}: this script only ever writes to Monad testnet (10143).`);
  if (record.contracts?.Stablecoin?.kind !== "MockAUSD") problems.push("The deployment's dollar is not the mock: this script mints test dollars and would need real AUSD instead.");
  if (!keys.deployer) problems.push("DEPLOYER_PRIVATE_KEY is not set (repo-root .env): it mints the mock dollars and funds the buyer's own calls.");
  if (!keys.relayer) problems.push("TESTNET_RELAYER_PRIVATE_KEY is not set (repo-root .env): the dev relayer's key.");
  if (keys.relayer && record.roles?.relayer && getAddress(record.roles.relayer) !== relayerAddress) {
    problems.push(`TESTNET_RELAYER_PRIVATE_KEY is ${relayerAddress}, but the deployment gave operator roles to ${record.roles.relayer}.`);
  }
  if (relayerBalance !== undefined && relayerBalance < minRelayer) problems.push(`The relayer holds ${formatEther(relayerBalance)} MON; it needs about ${formatEther(minRelayer)}.`);
  if (deployerBalance !== undefined && deployerBalance < minDeployer) problems.push(`The deployer holds ${formatEther(deployerBalance)} MON; it needs about ${formatEther(minDeployer)}.`);
  return problems;
}

async function main() {
  log("Polaris for Business on Monad testnet: the smoke test\n");
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : null;
  const keys = keysFrom({ ...parseEnvFile(join(REPO_DIR, ".env")), ...process.env });
  const chain = defineChain({
    id: 10143,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 500 });
  const relayer = keys.relayer ? privateKeyToAccount(keys.relayer) : null;
  const deployer = keys.deployer ? privateKeyToAccount(keys.deployer) : null;
  const problems = preflight({
    record,
    keys,
    relayerAddress: relayer?.address,
    relayerBalance: relayer ? await client.getBalance({ address: relayer.address }) : undefined,
    deployerBalance: deployer ? await client.getBalance({ address: deployer.address }) : undefined,
    minRelayer: parseEther("0.15"),
    minDeployer: BUYER_MON + parseEther("0.03"),
  });
  if ((await client.getChainId()) !== 10143) problems.push(`${RPC} is not Monad testnet.`);
  log(`  deployment  ${RECORD.replace(REPO_DIR, "").replace(/\\/g, "/")}`);
  if (relayer) log(`  relayer     ${relayer.address} (dev adapter, RELAYER_MODE=local)`);
  if (deployer) log(`  minter      ${deployer.address} (mints the mock dollar; funds the buyer's own calls)`);
  if (problems.length) {
    for (const p of problems) log(`  REFUSED     ${p}`);
    process.exitCode = 1;
    return;
  }
  if (!flag("run")) {
    log("\nReady. Nothing was sent. Re-run with --run for Pay now, Pay in 4 and a re-signed approval on Monad testnet.");
    return;
  }
  if (!Number.isInteger(INTERVAL) || INTERVAL < Number(record.config?.minInterval ?? 60)) throw new Error(`--interval must be at least ${record.config?.minInterval ?? 60} seconds`);
  for (const p of [PORT, HOOK_PORT]) if (!(await portFree(p))) throw new Error(`Port ${p} is in use.`);

  const C = Object.fromEntries(Object.entries(record.contracts).map(([k, v]) => [k, getAddress(v.address)]));
  const explorer = (record.explorer ?? "https://testnet.monadscan.com").replace(/\/+$/, "");
  const minter = createWalletClient({ account: deployer, chain, transport: http(RPC) });
  const relayerNonce0 = await client.getTransactionCount({ address: relayer.address });
  const relayerMon0 = await client.getBalance({ address: relayer.address });

  /** One transaction, read back: who sent it, to what, whether it landed, and its events. */
  async function onChain(what, hash, { from, to, by }) {
    // The receipt first: a public RPC may not serve a transaction it has only just accepted.
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    const tx = await until(`transaction ${hash}`, () => client.getTransaction({ hash }), { timeoutMs: 30_000 });
    assert(receipt.status === "success", `${what}: ${hash} reverted`);
    if (from) assert(getAddress(tx.from) === getAddress(from), `${what}: sent by ${tx.from}, expected ${from}`);
    if (to) assert(getAddress(tx.to) === getAddress(to), `${what}: sent to ${tx.to}, expected ${to}`);
    const row = { what, by, txHash: hash, block: Number(receipt.blockNumber), from: getAddress(tx.from), to: getAddress(tx.to), gasLimit: tx.gas.toString(), status: receipt.status, explorer: `${explorer}/tx/${hash}` };
    steps.push(row);
    return { tx, receipt, row };
  }

  // ── the SDK, built ─────────────────────────────────────────────────────
  if (!existsSync(join(SDK_DIR, "dist", "esm", "server.js"))) throw new Error("polarispay-sdk is not built: pnpm --filter polarispay-sdk build");
  const sdkServer = await import(new URL(`file:///${join(SDK_DIR, "dist", "esm", "server.js").replace(/\\/g, "/")}`).href);

  // ── the webhook receiver ───────────────────────────────────────────────
  const received = [];
  let webhookSecret = null;
  const hooks = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        received.push({ event: sdkServer.verifyWebhook(raw, req.headers["polaris-signature"], webhookSecret) });
        res.writeHead(204).end();
      } catch (error) {
        received.push({ error: error.message });
        res.writeHead(400).end("bad signature");
      }
    });
  });
  await new Promise((r) => hooks.listen(HOOK_PORT, "127.0.0.1", r));

  // ── the server ─────────────────────────────────────────────────────────
  work = mkdtempSync(join(tmpdir(), "polaris-smoke-"));
  const dbUrl = `sqlite:${join(work, "polaris.db")}`;
  const pepper = randomBytes(16).toString("hex");
  const serverEnv = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    POLARIS_DEPLOYMENT_FILE: RECORD,
    POLARIS_RPC_URL: RPC,
    RELAYER_MODE: "local",
    RELAYER_LOCAL_ALLOW_TESTNET: "1",
    RELAYER_PRIVATE_KEY: keys.relayer,
    REGISTRY_ACTIVATOR: "off",
    POLARIS_DB_URL: dbUrl,
    POLARIS_KEY_PEPPER: pepper,
    POLARIS_DISABLE_PRIVY: "1",
    POLARIS_WEBHOOK_ALLOW_PRIVATE: "1",
    POLARIS_CHECKOUT_ORIGIN: "http://localhost:3852",
    POLARIS_PUBLIC_URL: BASE,
    POLARIS_WORKERS: "1",
    PAY_IN_4_INTERVAL_SECONDS: String(INTERVAL),
    CRON_SECRET: randomBytes(16).toString("hex"),
    RELAYER_RECEIPT_TIMEOUT_MS: "60000",
  };
  // The server imports @polarispay/underwriting's compiled core: build it if it is missing or stale.
  const deps = background("ensure-deps", process.execPath, [join(APP_DIR, "scripts", "ensure-deps.mjs")], { cwd: APP_DIR });
  const depsCode = await new Promise((resolve) => deps.on("exit", resolve));
  if (depsCode !== 0) throw new Error(`scripts/ensure-deps.mjs exited ${depsCode}`);
  const next = join(APP_DIR, "node_modules", "next", "dist", "bin", "next");
  background("next", process.execPath, [next, "dev", "--port", String(PORT)], { cwd: APP_DIR, env: serverEnv });
  const health = await until(
    "Polaris for Business",
    async () => {
      const h = await api("/api/health");
      return h.status === 200 && h.body?.data?.ok ? h.body.data : null;
    },
    { timeoutMs: 420_000, everyMs: 2000 },
  );
  assert(health.chain.id === 10143, "the server is on Monad testnet");
  assert(getAddress(health.relayer.address) === relayer.address, "the server relays with the dev relayer's key");
  pass("Polaris for Business is up on Monad testnet", `(relayer ${health.relayer.mode} ${health.relayer.address}, chain ${health.chain.id})`);

  const seeded = await seedMerchant({ dbUrl, pepper, wallet: record.demo.merchant, name: record.demo.merchantName, webhookUrl: `http://127.0.0.1:${HOOK_PORT}/webhook`, registration: "active" });
  webhookSecret = seeded.webhookSecret;
  pass("demo merchant seeded with an sk_test_ key and a webhook endpoint", `(${record.demo.merchantName}, ${record.demo.merchant})`);
  const polaris = sdkServer.createPolarisServer({ secretKey: seeded.secretKey, baseUrl: BASE });
  const waitFor = (type, match) => until(`the ${type} webhook`, () => received.find((r) => r.event?.type === type && match(r.event)), { timeoutMs: 120_000 });

  // ── the buyer: mock dollars, and a few cents of MON for its own three calls ──
  const buyer = privateKeyToAccount(generatePrivateKey());
  const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(RPC) });
  const mint = await minter.writeContract({ address: C.Stablecoin, abi: mockAUSDAbi, functionName: "mint", args: [buyer.address, 1_000_000_000n] });
  await onChain("mint $1,000.00 of MockAUSD (the labelled mock dollar) to the test buyer", mint, { from: deployer.address, to: C.Stablecoin, by: "deployer" });
  const gas = await minter.sendTransaction({ to: buyer.address, value: BUYER_MON, gas: 21_000n });
  await onChain(`${formatEther(BUYER_MON)} MON to the test buyer, for its own collateral and approval calls`, gas, { from: deployer.address, to: buyer.address, by: "deployer" });
  pass("a fresh buyer holds $1,000.00 in mock dollars", `(${buyer.address})`);

  // ── Pay now ────────────────────────────────────────────────────────────
  const orderNow = `smoke-now-${Date.now()}`;
  const s1 = await polaris.checkout.sessions.create(
    { amount: `${PAY_NOW_USD}.00`, description: "Smoke test: Pay now", modes: ["now"], successUrl: "http://localhost:3852/thanks", orderId: orderNow },
    { idempotencyKey: orderNow },
  );
  const pub1 = (await api(`/api/public/sessions/${s1.id}`)).body.data;
  const domain = { ...pub1.chain.stablecoinDomain, chainId: pub1.chain.chainId, verifyingContract: pub1.chain.contracts.stablecoin };
  assert(getAddress(domain.verifyingContract) === C.Stablecoin, "the session signs for the deployment's dollar");
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
  const rwa = await buyer.signTypedData({
    domain,
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: buyer.address, to: pub1.chain.contracts.payments, value: BigInt(PAY_NOW_USD) * 1_000_000n, validAfter: 0n, validBefore, nonce: pub1.chain.orderKey },
  });
  const paid = await api("/api/relay", { method: "POST", body: JSON.stringify({ type: "pay", sessionId: s1.id, buyer: buyer.address, validAfter: "0", validBefore: String(validBefore), signature: rwa }) });
  assert(paid.status === 200 && paid.body.data.status === "confirmed", `relay pay: ${JSON.stringify(paid.body)}`);
  const payTx = await onChain(`Pay now $${PAY_NOW_USD}.00: PolarisCheckout.pay relayed`, paid.body.data.txHash, { from: relayer.address, to: C.PolarisCheckout, by: "relayer" });
  const paidEvents = parseEventLogs({ abi: polarisCheckoutAbi, logs: payTx.receipt.logs }).map((e) => e.eventName);
  assert(paidEvents.length > 0, "PolarisCheckout emitted its order events");
  payTx.row.events = paidEvents;
  pass("Pay now relayed and settled", `(${paid.body.data.txHash})`);
  const payEvent = await waitFor("payment.succeeded", (e) => e.data.sessionId === s1.id);
  pass("payment.succeeded webhook arrived, verified by polarispay-sdk", `(${payEvent.event.id})`);

  // ── a secured line: the buyer locks collateral itself ──────────────────
  const quoteFor = () => client.readContract({ address: C.PolarisCheckout, abi: polarisCheckoutAbi, functionName: "quotePlan", args: [buyer.address, BigInt(PLAN_USD) * 1_000_000n, 4, BigInt(INTERVAL)] });
  const q0 = await quoteFor();
  const collateral = ((q0.totalOwed + 999_999n) / 1_000_000n + 1n) * 1_000_000n; // whole dollars, above everything owed
  const approveVault = await buyerWallet.writeContract({ address: C.Stablecoin, abi: mockAUSDAbi, functionName: "approve", args: [C.CollateralVault, collateral] });
  await onChain(`the buyer approves CollateralVault for $${formatUnits(collateral, 6)} (its own call)`, approveVault, { from: buyer.address, to: C.Stablecoin, by: "buyer" });
  const lock = await buyerWallet.writeContract({ address: C.CollateralVault, abi: collateralVaultAbi, functionName: "lock", args: [collateral] });
  await onChain(`the buyer locks $${formatUnits(collateral, 6)} in CollateralVault (its own call): a secured line`, lock, { from: buyer.address, to: C.CollateralVault, by: "buyer" });
  const limit = await client.readContract({ address: C.ScoreManager, abi: scoreManagerAbi, functionName: "creditLimitOf", args: [buyer.address] });
  assert(limit === collateral, `a never-underwritten wallet borrows against collateral at face value (limit ${limit})`);
  pass("secured credit line from locked collateral (no CRE underwriting report yet)", `(limit $${formatUnits(limit, 6)})`);

  // ── Pay in 4 ───────────────────────────────────────────────────────────
  const orderPlan = `smoke-plan-${Date.now()}`;
  const s2 = await polaris.checkout.sessions.create(
    { amount: `${PLAN_USD}.00`, description: "Smoke test: Pay in 4", modes: ["later"], successUrl: "http://localhost:3852/thanks", orderId: orderPlan },
    { idempotencyKey: orderPlan },
  );
  const pub2 = (await api(`/api/public/sessions/${s2.id}`)).body.data;
  assert(pub2.payIn4?.available, `Pay in 4 offered: ${JSON.stringify(pub2.payIn4)}`);
  const [paused] = await client.readContract({ address: C.PolarisCheckout, abi: polarisCheckoutAbi, functionName: "creditPaused" });
  const quote = await quoteFor();
  assert(quote.withinLimit, "the plan fits the secured line");
  const checkoutNonce = await client.readContract({ address: C.PolarisCheckout, abi: polarisCheckoutAbi, functionName: "nonces", args: [buyer.address] });
  const tokenNonce = await client.readContract({ address: C.Stablecoin, abi: mockAUSDAbi, functionName: "nonces", args: [buyer.address] });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const intent = { buyer: buyer.address, merchant: pub2.chain.merchant, principal: BigInt(PLAN_USD) * 1_000_000n, installments: 4, interval: BigInt(INTERVAL), orderId: pub2.chain.orderId, nonce: checkoutNonce, deadline: now + 600n };
  const intentSig = await buyer.signTypedData({
    domain: { name: "PolarisCheckout", version: "1", chainId: 10143, verifyingContract: C.PolarisCheckout },
    types: {
      PlanIntent: [
        { name: "buyer", type: "address" },
        { name: "merchant", type: "address" },
        { name: "principal", type: "uint256" },
        { name: "installments", type: "uint32" },
        { name: "interval", type: "uint64" },
        { name: "orderId", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "PlanIntent",
    message: intent,
  });
  const permitTypes = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const permitSig = await buyer.signTypedData({ domain, types: permitTypes, primaryType: "Permit", message: { owner: buyer.address, spender: C.PolarisLoanEngine, value: quote.permitValue, nonce: tokenNonce, deadline: now + 1800n } });
  const opened = await api("/api/relay", {
    method: "POST",
    body: JSON.stringify({
      type: "openPlan",
      sessionId: s2.id,
      intent: { buyer: buyer.address, principal: String(intent.principal), installments: "4", interval: String(INTERVAL), nonce: String(checkoutNonce), deadline: String(intent.deadline) },
      signature: intentSig,
      permit: { value: String(quote.permitValue), deadline: String(now + 1800n), signature: permitSig },
    }),
  });
  assert(opened.status === 200 && opened.body.data.status === "confirmed" && opened.body.data.planId, `relay openPlan: ${JSON.stringify(opened.body)}`);
  const planTx = await onChain(`Pay in 4 $${PLAN_USD}.00 (4 instalments, ${INTERVAL} s apart): PolarisCheckout.openPlan relayed`, opened.body.data.txHash, { from: relayer.address, to: C.PolarisCheckout, by: "relayer" });
  planTx.row.planId = opened.body.data.planId;
  planTx.row.guardian = paused ? "paused" : "open (no attestation yet: fails open by design)";
  planTx.row.events = parseEventLogs({ abi: polarisLoanEngineAbi, logs: planTx.receipt.logs }).map((e) => e.eventName);
  pass("Pay in 4 opened through /api/relay (PlanIntent + Permit)", `(plan #${opened.body.data.planId}, ${opened.body.data.txHash})`);
  const planEvent = await waitFor("plan.opened", (e) => e.data.sessionId === s2.id);
  assert(planEvent.event.data.schedule.length === 4, "plan.opened carries the schedule");
  pass("plan.opened webhook arrived with the four-instalment schedule", `(${planEvent.event.data.schedule.map((s) => s.amount).join(", ")})`);

  // ── a lost approval, signed again ──────────────────────────────────────
  const revoke = await buyerWallet.writeContract({ address: C.Stablecoin, abi: mockAUSDAbi, functionName: "approve", args: [C.PolarisLoanEngine, 0n] });
  await onChain("the buyer sets its approval to the loan engine to 0 (its own call): a lost approval", revoke, { from: buyer.address, to: C.Stablecoin, by: "buyer" });
  const owed = await client.readContract({ address: C.PolarisLoanEngine, abi: polarisLoanEngineAbi, functionName: "activeDebtOf", args: [buyer.address] });
  const reNonce = await client.readContract({ address: C.Stablecoin, abi: mockAUSDAbi, functionName: "nonces", args: [buyer.address] });
  const reDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const reSig = await buyer.signTypedData({ domain, types: permitTypes, primaryType: "Permit", message: { owner: buyer.address, spender: C.PolarisLoanEngine, value: owed, nonce: reNonce, deadline: reDeadline } });
  const re = await api("/api/relay", { method: "POST", body: JSON.stringify({ type: "reauthorize", buyer: buyer.address, permit: { value: String(owed), deadline: String(reDeadline), signature: reSig } }) });
  assert(re.status === 200 && re.body.data.status === "confirmed", `relay reauthorize: ${JSON.stringify(re.body)}`);
  const reTx = await onChain("the buyer signs again: PolarisCheckout.reauthorize relayed (Reauthorized: the collections workflow's log trigger)", re.body.data.txHash, { from: relayer.address, to: C.PolarisCheckout, by: "relayer" });
  const reauthorized = parseEventLogs({ abi: polarisCheckoutAbi, logs: reTx.receipt.logs, eventName: "Reauthorized" });
  assert(reauthorized.length === 1 && getAddress(reauthorized[0].args.buyer) === buyer.address, "PolarisCheckout emitted Reauthorized for the buyer");
  reTx.row.events = ["Reauthorized"];
  reTx.row.reauthorizedLogIndex = reTx.receipt.logs.findIndex((l) => l.logIndex === reauthorized[0].logIndex);
  pass("a lost approval signed again through /api/relay, Reauthorized emitted", `(${re.body.data.txHash}, log ${reTx.row.reauthorizedLogIndex})`);

  // ── checks ─────────────────────────────────────────────────────────────
  const bad = received.filter((r) => r.error);
  assert(bad.length === 0, `every delivery verified (${bad.map((b) => b.error).join("; ")})`);
  const relayerNonce1 = await client.getTransactionCount({ address: relayer.address });
  const relayerMon1 = await client.getBalance({ address: relayer.address });
  const buyerTxs = await client.getTransactionCount({ address: buyer.address });
  assert(buyerTxs === 3, `the buyer sent only its three own calls (approve, lock, approve 0), not ${buyerTxs}`);
  pass("the buyer signed every Polaris step and sent only its collateral and approval calls", `(relayer sent ${relayerNonce1 - relayerNonce0} transactions, ${formatEther(relayerMon0 - relayerMon1)} MON)`);

  hooks.close();
  const result = {
    at: new Date().toISOString(),
    chainId: 10143,
    note:
      "Written by pnpm --filter @polaris/business smoke:testnet -- --run. The dollar is MockAUSD, a labelled mock for the testnet demo. " +
      "The relayer is the dev adapter (RELAYER_MODE=local on testnet), standing in for the Privy relayer. The buyer's Pay in 4 line is secured by collateral it locked itself: " +
      "an unsecured line needs the CRE underwriting report (requireUnderwriting is on).",
    server: { url: BASE, relayer: relayer.address, relayerTransactions: relayerNonce1 - relayerNonce0, relayerMonSpent: formatEther(relayerMon0 - relayerMon1) },
    buyer: buyer.address,
    merchant: record.demo.merchant,
    payNow: { sessionId: s1.id, orderId: orderNow, txHash: paid.body.data.txHash, webhook: payEvent.event.id },
    payIn4: { sessionId: s2.id, orderId: orderPlan, planId: opened.body.data.planId, intervalSeconds: INTERVAL, txHash: opened.body.data.txHash, webhook: planEvent.event.id, schedule: planEvent.event.data.schedule },
    reauthorize: { txHash: re.body.data.txHash, reauthorizedLogIndex: reTx.row.reauthorizedLogIndex, evidence: `pnpm --filter @polaris/cre-workflows evidence --retry-tx ${re.body.data.txHash}` },
    steps,
  };
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  log(`\nAll ${n} checks passed. Every hash: ${OUT.replace(REPO_DIR, "").replace(/\\/g, "/")}`);
  log("\n| Step | Sent by | Transaction |\n|---|---|---|");
  for (const s of steps) log(`| ${s.what} | ${s.by} | [${s.txHash.slice(0, 10)}…](${s.explorer}) |`);
}

function stopAll() {
  for (const { child } of children) {
    try {
      if (child.exitCode !== null) continue;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch {
      // gone
    }
  }
}

if (process.argv[1] && /smoke-testnet\.mjs$/.test(process.argv[1])) {
  main()
    .catch((error) => {
      console.error(`\nFAILED: ${error.message}`);
      if (steps.length) console.error(`Sent before the failure:\n${steps.map((s) => `  ${s.what}: ${s.txHash}`).join("\n")}`);
      for (const { name, lines } of children) console.error(`\n── last lines of ${name} ──\n${lines.slice(-40).join("\n")}`);
      process.exitCode = 1;
    })
    .finally(() => {
      stopAll();
      setTimeout(() => {
        try {
          if (work) rmSync(work, { recursive: true, force: true });
        } catch {
          // Windows may still hold the database for a moment
        }
        process.exit(process.exitCode ?? 0);
      }, 1500);
    });
}
