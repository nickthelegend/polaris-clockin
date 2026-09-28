#!/usr/bin/env node
/**
 * The whole product on this machine, with nothing live:
 *
 *   pnpm demo:local
 *
 *  1. a Hardhat node (chain 31337) with every Polaris contract deployed by
 *     packages/contracts' own deploy script (scripts/deploy-monad.js on
 *     monadLocal): MockAUSD, a funded credit pool, the demo merchant
 *     registered and active for Pay in 4, a local CRE forwarder;
 *  2. Polaris for Business (apps/business) on :3100 against it, with the dev
 *     relayer adapter (a local key held to the production relayer policy),
 *     Privy off, a fresh SQLite store, the demo merchant seeded with API keys
 *     and a webhook to the shop, and a signed-in dashboard for that merchant
 *     (a random local session token; see server/auth.ts `localSession`);
 *  3. the CRE underwriting trigger's local fallback (workflows, trigger:local)
 *     on :2000: "Bring your history" in the app runs the real underwriting
 *     workflow handler against the local chain, with fixture evidence;
 *  4. the Polaris app (apps/app) on :3000: the hosted checkout, with the dev
 *     signer standing in for Face ID, reading everything from the API;
 *  5. Halcyon, the demo shop (apps/shop), on :3600, paying through
 *     polarispay-sdk against the real API and checkout (no dev mock);
 *  6. a local faucet on :3650 for test dollars (MockAUSD), which the app's
 *     Add money sheet offers on this chain;
 *  7. the CRE collections workflow's local stand-in (workflows,
 *     collections:local): the real `polaris-collections` handler on both of
 *     its triggers, the cron every minute (collecting the Pay in 4
 *     instalments that are due through CollectionsReceiver) and the EVM log
 *     trigger on PolarisCheckout's Reauthorized (the instant retry after a
 *     buyer signs again), reporting to the API (the dashboard's Collections
 *     card and Chainlink page, installment.collected webhooks);
 *  8. the CRE guardian's local stand-in (workflows, guardian:local): the real
 *     `polaris-guardian` handler every minute, reading Chainlink's AUSD/USD
 *     Data Feed on Monad MAINNET (public RPC, reads only) and the pool on the
 *     local chain, and attesting to GuardianReceiver, which PolarisCheckout
 *     asks before every new Pay in 4 plan. DEMO_GUARDIAN_PRICE=mock reads
 *     the local chain's labelled MockAusdUsdFeed instead (offline); without
 *     it, a mainnet feed that cannot be read falls back to the mock, and the
 *     banner says so.
 *
 * `node scripts/demo-chainlink.mjs` drives the Chainlink scenes on a running
 * demo (the guardian's demo threshold, a lost approval); `pnpm
 * demo:e2e:chainlink` plays them headless end to end.
 *
 * Before it prints the URLs it opens every page and API route once, so no
 * first click waits for `next dev` to compile it.
 *
 * DEMO_FAST_PLANS=1 makes Pay in 4 instalments a minute apart instead of a
 * week (PAY_IN_4_INTERVAL_SECONDS=60, the local deployment's minimum), so
 * the collections run is on camera: instalment 2 is collected about a
 * minute after checkout. Its log is .demo/logs/cre-collections.log. It
 * also sets the loan engine's grace to 15 minutes (GRACE_SECONDS overrides),
 * so a missed payment is dunned, and can be signed for again, before it is
 * liquidated.
 * DEMO_PAY_IN_4_INTERVAL_SECONDS sets the interval outright (it wins over
 * DEMO_FAST_PLANS).
 *
 * Then open http://127.0.0.1:3600, add something to the bag and check out
 * with Polaris. The dashboard is http://localhost:3100/dashboard. To split a
 * bill, open the app's More sheet (Split a bill on the desktop); the split is
 * PolarisSplit on this chain, and `pnpm demo:e2e:split` plays it headless.
 *
 * Ports: DEMO_NODE_PORT (8545), DEMO_BUSINESS_PORT (3100), DEMO_APP_PORT
 * (3000), DEMO_SHOP_PORT (3600), DEMO_TRIGGER_PORT (2000), DEMO_FAUCET_PORT
 * (3650). State lives in .demo/ (git-ignored) and is fresh on every run;
 * .demo/demo.json has every URL. Stop with Ctrl+C; everything started here
 * stops with it.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = join(REPO, "packages", "contracts");
const BUSINESS = join(REPO, "apps", "business");
const APP = join(REPO, "apps", "app");
const SHOP = join(REPO, "apps", "shop");
const WORKFLOWS = join(REPO, "workflows");
const DEMO = join(REPO, ".demo");

const port = (name, fallback) => Number(process.env[name] || fallback);
const PORTS = {
  node: port("DEMO_NODE_PORT", 8545),
  business: port("DEMO_BUSINESS_PORT", 3100),
  app: port("DEMO_APP_PORT", 3000),
  shop: port("DEMO_SHOP_PORT", 3600),
  trigger: port("DEMO_TRIGGER_PORT", 2000),
  faucet: port("DEMO_FAUCET_PORT", 3650),
};
const FAST_PLANS = process.env.DEMO_FAST_PLANS === "1";
const RPC = `http://127.0.0.1:${PORTS.node}`;
const BUSINESS_URL = `http://localhost:${PORTS.business}`;
const APP_URL = `http://localhost:${PORTS.app}`;
const SHOP_URL = `http://127.0.0.1:${PORTS.shop}`;
const FAUCET_URL = `http://127.0.0.1:${PORTS.faucet}`;

// Hardhat's well-known local test accounts (public; valid only on a local node).
const HARDHAT_KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer, registry owner, CRE transmitter, MockAUSD minter
  relayer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // the dev relayer adapter
};
const RELAYER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const children = [];
let stopping = false;

function log(msg) {
  console.log(`[demo] ${msg}`);
}

function need(path, what) {
  if (!existsSync(path)) throw new Error(`${what} is missing (${path}). Run \`pnpm install\` at the repo root first.`);
  return path;
}

async function portFree(p) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** Run to completion; `pnpm` goes through the shell on Windows (it is a .cmd there). */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: cmd === "pnpm" && process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${[cmd, ...args].join(" ")} exited ${r.status}`);
}

const fileUrl = (path) => new URL(`file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`).href;

/** A long-running child whose output goes to .demo/logs/<name>.log. */
function background(name, cmd, args, opts = {}) {
  const logFile = join(DEMO, "logs", `${name}.log`);
  const out = createWriteStream(logFile);
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...opts });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on("exit", (code) => {
    if (!stopping) log(`${name} exited (${code}); its log is ${logFile}`);
  });
  children.push({ name, child });
  return child;
}

async function until(what, check, timeoutMs) {
  const started = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what} (see .demo/logs)`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Open every page and API route once so `next dev` compiles it now, not on
 * the first click (a first POST to a route took 30 s; the landing 50 s).
 * Any answer counts, a 404 or a 401 included: the route is compiled.
 */
async function warm(base, routes) {
  const started = Date.now();
  let failed = 0;
  for (const route of routes) {
    const [method, path, body] = typeof route === "string" ? ["GET", route, undefined] : route;
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      });
      await res.arrayBuffer();
    } catch {
      failed++;
    }
  }
  return { ms: Date.now() - started, failed };
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** Chainlink's AUSD/USD on Monad mainnet: the price polaris-guardian reads in staging and production. */
const AUSD_USD_MONAD_MAINNET = "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13";
const MONAD_MAINNET_RPC = process.env.POLARIS_MONAD_MAINNET_RPC || "https://rpc.monad.xyz";

/**
 * Where the local guardian reads AUSD/USD: Chainlink's feed on Monad mainnet
 * when its public RPC answers as that feed (chain 143, "AUSD / USD"), else
 * the local chain's labelled mock. DEMO_GUARDIAN_PRICE=mainnet|mock decides.
 */
async function guardianPriceSource() {
  const forced = process.env.DEMO_GUARDIAN_PRICE;
  if (forced === "mock") return { price: "mock", why: "DEMO_GUARDIAN_PRICE=mock: the local MockAusdUsdFeed (not Chainlink)" };
  const call = async (method, params) => {
    const res = await fetch(MONAD_MAINNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  try {
    if ((await call("eth_chainId", [])) !== "0x8f") throw new Error(`${MONAD_MAINNET_RPC} is not Monad mainnet (143)`);
    // description(): an ABI-encoded string, "AUSD / USD"
    const hex = await call("eth_call", [{ to: AUSD_USD_MONAD_MAINNET, data: "0x7284e416" }, "latest"]);
    const length = Number.parseInt(hex.slice(66, 130), 16);
    const text = Buffer.from(hex.slice(130, 130 + length * 2), "hex").toString("utf8");
    if (text !== "AUSD / USD") throw new Error(`the feed says "${text}"`);
    return { price: "mainnet", why: `Chainlink AUSD / USD on Monad mainnet via ${MONAD_MAINNET_RPC}` };
  } catch (error) {
    if (forced === "mainnet") throw new Error(`DEMO_GUARDIAN_PRICE=mainnet, but the feed could not be read: ${error.message}`);
    return { price: "mock", why: `Monad mainnet unreachable (${error.message}): the local MockAusdUsdFeed (not Chainlink) stands in` };
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const { child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  log("stopping…");
  stop();
  process.exit(0);
});
process.on("exit", (code) => {
  if (code !== 0) log(`exiting (${code}); stopping everything it started`);
  stop();
});
process.on("uncaughtException", (error) => {
  console.error(`[demo] ${error?.stack ?? error}`);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(`[demo] unhandled: ${error?.stack ?? error}`);
});

/* ── The faucet: test dollars on the local chain only ──────────────────── */

async function startFaucet(stablecoin, mint) {
  const allowed = new Set([APP_URL, `http://127.0.0.1:${PORTS.app}`]);
  const server = createServer((req, res) => {
    const origin = req.headers.origin ?? "";
    const cors = allowed.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", vary: "origin" } : {};
    if (req.method === "OPTIONS") return res.writeHead(204, { ...cors, "access-control-allow-methods": "POST" }).end();
    if (req.method !== "POST" || req.url !== "/mint") return res.writeHead(404, cors).end();
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { address } = JSON.parse(raw);
        if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("address must be a 0x address");
        const txHash = await mint(address);
        log(`faucet: $500.00 test dollars to ${address}`);
        res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ data: { amount: "500.00", txHash, stablecoin } }));
      } catch (error) {
        res.writeHead(400, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: { code: "invalid_request", message: error.message } }));
      }
    });
  });
  await new Promise((r) => server.listen(PORTS.faucet, "127.0.0.1", r));
  return server;
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  for (const [name, p] of Object.entries(PORTS)) {
    if (!(await portFree(p))) throw new Error(`Port ${p} (${name}) is in use. Stop what's there, or set DEMO_${name.toUpperCase()}_PORT.`);
  }
  rmSync(DEMO, { recursive: true, force: true });
  mkdirSync(join(DEMO, "logs"), { recursive: true });

  const hardhat = need(join(CONTRACTS, "node_modules", "hardhat", "internal", "cli", "bootstrap.js"), "Hardhat");
  const nextBin = (dir) => need(join(dir, "node_modules", "next", "dist", "bin", "next"), `Next in ${dir}`);

  log("building the SDK and the underwriting package…");
  run("pnpm", ["--filter", "polarispay-sdk", "build"], { cwd: REPO, stdio: "ignore" });
  run(process.execPath, [join(BUSINESS, "scripts", "ensure-deps.mjs")], { cwd: BUSINESS });

  // ── 1. chain ──────────────────────────────────────────────────────────
  log(`starting a Hardhat node on ${RPC}…`);
  background("hardhat", process.execPath, [hardhat, "node", "--hostname", "127.0.0.1", "--port", String(PORTS.node)], { cwd: CONTRACTS });
  await until("the Hardhat node", async () => (await rpc("eth_chainId")) === "0x7a69", 120_000);
  log("compiling and deploying the contracts (packages/contracts scripts/deploy-monad.js)…");
  run(process.execPath, [hardhat, "compile", "--quiet"], { cwd: CONTRACTS, stdio: "ignore" });
  const deployLog = openSync(join(DEMO, "logs", "deploy.log"), "w");
  run(process.execPath, [hardhat, "run", "scripts/deploy-monad.js", "--network", "monadLocal"], {
    cwd: CONTRACTS,
    stdio: ["ignore", deployLog, deployLog],
    env: {
      ...process.env,
      POLARIS_LOCAL_NODE_PORT: String(PORTS.node),
      RELAYER_ADDRESS,
      // With instalments a minute apart, the local default grace (2 min) would liquidate a missed payment before
      // the buyer could sign again; 15 min keeps the dunning (and the instant retry) on screen. GRACE_SECONDS wins.
      ...(FAST_PLANS && !process.env.GRACE_SECONDS ? { GRACE_SECONDS: "900" } : {}),
    },
  });
  const deploymentFile = join(DEMO, "deployment.json");
  copyFileSync(join(CONTRACTS, "deployments", "monad-local.json"), deploymentFile);
  const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
  // The guardian's price. The API and the dashboard read which feed it is from this record, so it names what the runner reads.
  const guardianPrice = await guardianPriceSource();
  log(`guardian price: ${guardianPrice.why}`);
  if (guardianPrice.price === "mainnet") {
    deployment.cre.workflows.guardian.priceFeed = {
      chainId: 143,
      chainSelectorName: "monad-mainnet",
      address: AUSD_USD_MONAD_MAINNET,
      decimals: 8,
      description: "AUSD / USD",
      kind: "chainlink",
    };
    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  }
  const at = (name) => deployment.contracts[name].address;
  log(`deployed on chain ${deployment.chainId}: PolarisCheckout ${at("PolarisCheckout")}, demo merchant ${deployment.demo.merchant} (${deployment.demo.merchantName})`);

  // viem and the ABIs, from the business app's dependencies.
  const requireBusiness = createRequire(join(BUSINESS, "package.json"));
  const viem = await import(fileUrl(requireBusiness.resolve("viem")));
  const accounts = await import(fileUrl(requireBusiness.resolve("viem/accounts")));
  const { mockAUSDAbi } = await import(fileUrl(join(CONTRACTS, "abi", "index.mjs")));
  const chain = viem.defineChain({ id: deployment.chainId, name: "Local Hardhat", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const owner = viem.createWalletClient({ account: accounts.privateKeyToAccount(HARDHAT_KEYS.owner), chain, transport: viem.http(RPC) });
  const reader = viem.createPublicClient({ chain, transport: viem.http(RPC) });
  async function registerMerchant(account) {
    const auth = { authorization: `Bearer ${secrets.session}`, "content-type": "application/json", origin: BUSINESS_URL };
    const get = await fetch(`${BUSINESS_URL}/api/merchant/registration`, { headers: auth });
    const step = (await get.json()).data;
    if (!step?.typedData) return step?.merchant?.registration?.state ?? "unknown";
    const t = step.typedData;
    const fields = t.types[t.primaryType];
    const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, /^u?int\d*$/.test(fields.find((f) => f.name === k)?.type ?? "") ? BigInt(v) : v]));
    const { EIP712Domain: _unused, ...types } = t.types;
    const signature = await account.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message });
    const post = await fetch(`${BUSINESS_URL}/api/merchant/registration`, { method: "POST", headers: auth, body: JSON.stringify({ signature, deadline: String(t.message.deadline) }) });
    const body = await post.json();
    if (!post.ok) throw new Error(`registration failed: ${JSON.stringify(body.error ?? body)}`);
    return body.data.merchant.registration.state;
  }

  const mint = async (address) => {
    const hash = await owner.writeContract({ address: at("Stablecoin"), abi: mockAUSDAbi, functionName: "mint", args: [address, 500_000_000n] });
    await reader.waitForTransactionReceipt({ hash });
    return hash;
  };

  // ── 2. the merchant, and the business server ───────────────────────────
  const secrets = {
    pepper: randomBytes(16).toString("hex"),
    session: randomBytes(24).toString("base64url"),
    callback: randomBytes(24).toString("hex"),
    cron: randomBytes(16).toString("hex"),
  };
  const dbUrl = `sqlite:${join(DEMO, "polaris.db")}`;
  const { seedMerchant } = await import(fileUrl(join(BUSINESS, "scripts", "lib", "seed.mjs")));
  // Halcyon's own merchant: a fresh payout wallet (a throwaway key for this
  // run), not yet on chain. It registers below through the dashboard's API.
  const merchantKey = accounts.generatePrivateKey();
  const merchant = accounts.privateKeyToAccount(merchantKey);
  const MERCHANT_NAME = "Halcyon";
  const seeded = await seedMerchant({
    dbUrl,
    pepper: secrets.pepper,
    wallet: merchant.address,
    name: MERCHANT_NAME,
    webhookUrl: `${SHOP_URL}/api/webhooks/polaris`,
    registration: "none",
  });
  log(`seeded ${MERCHANT_NAME} (${seeded.merchant.publicId}, payout wallet ${merchant.address}) with test API keys and a webhook to the shop`);

  const businessEnv = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    POLARIS_DEPLOYMENT_FILE: deploymentFile,
    POLARIS_RPC_URL: RPC,
    RELAYER_MODE: "local",
    RELAYER_PRIVATE_KEY: HARDHAT_KEYS.relayer,
    REGISTRY_ACTIVATOR: "local",
    REGISTRY_OWNER_PRIVATE_KEY: HARDHAT_KEYS.owner,
    POLARIS_DB_URL: dbUrl,
    POLARIS_KEY_PEPPER: secrets.pepper,
    POLARIS_DISABLE_PRIVY: "1",
    POLARIS_WEBHOOK_ALLOW_PRIVATE: "1",
    POLARIS_CHECKOUT_ORIGIN: APP_URL,
    POLARIS_PUBLIC_URL: BUSINESS_URL,
    POLARIS_APP_ORIGINS: `http://127.0.0.1:${PORTS.app}`,
    POLARIS_WORKERS: "1",
    // A week between instalments, as in production. DEMO_FAST_PLANS=1 makes it a minute, so the collections run
    // shows on camera; DEMO_PAY_IN_4_INTERVAL_SECONDS sets it outright (the local chain allows 60 s) so a recording
    // can show an instalment fall due, fail and be collected without moving the chain's clock.
    PAY_IN_4_INTERVAL_SECONDS:
      process.env.DEMO_PAY_IN_4_INTERVAL_SECONDS || (FAST_PLANS ? String(Math.max(60, deployment.config?.minInterval ?? 60)) : "604800"),
    CRON_SECRET: secrets.cron,
    CRE_UNDERWRITING_TRIGGER_URL: `http://127.0.0.1:${PORTS.trigger}/trigger`,
    CRE_TRIGGER_MIN_INTERVAL_MS: "2000",
    POLARIS_CRE_CALLBACK_SECRET: secrets.callback,
    POLARIS_LOCAL_SESSION_TOKEN: secrets.session,
    POLARIS_LOCAL_SESSION_WALLET: merchant.address,
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION: secrets.session,
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET: merchant.address,
    // This run's throwaway payout key, so the dashboard can sign as Privy's embedded wallet would (local chain only).
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION_KEY: merchantKey,
    NEXT_PUBLIC_DEMO_SHOP_URL: SHOP_URL,
    NEXT_PUBLIC_PRIVY_APP_ID: "",
  };
  log(`starting Polaris for Business on ${BUSINESS_URL}…`);
  background("business", process.execPath, [nextBin(BUSINESS), "dev", "--port", String(PORTS.business)], { cwd: BUSINESS, env: businessEnv });

  // ── 3. the CRE underwriting trigger (local fallback) ───────────────────
  background("cre-trigger", process.execPath, [join(WORKFLOWS, "scripts", "local-trigger.mjs")], {
    cwd: WORKFLOWS,
    env: {
      ...process.env,
      POLARIS_LOCAL_RPC: RPC,
      POLARIS_LOCAL_DEPLOYMENT: deploymentFile,
      POLARIS_LOCAL_TRIGGER_PORT: String(PORTS.trigger),
      POLARIS_CALLBACK_URL: `${BUSINESS_URL}/api/cre/callback`,
      POLARIS_CALLBACK_SECRET: secrets.callback,
    },
  });

  // ── 3b. the CRE collections workflow (local stand-in): its cron every minute, and its log trigger ──
  background("cre-collections", process.execPath, [join(WORKFLOWS, "scripts", "local-collections.mjs")], {
    cwd: WORKFLOWS,
    env: {
      ...process.env,
      POLARIS_LOCAL_RPC: RPC,
      POLARIS_LOCAL_DEPLOYMENT: deploymentFile,
      POLARIS_LOCAL_COLLECTIONS_EVERY_MS: "60000",
      POLARIS_CALLBACK_URL: `${BUSINESS_URL}/api/cre/callback`,
      POLARIS_CALLBACK_SECRET: secrets.callback,
    },
  });

  // ── 3c. the CRE guardian (local stand-in), every minute ─────────────────
  background("cre-guardian", process.execPath, [join(WORKFLOWS, "scripts", "local-guardian.mjs")], {
    cwd: WORKFLOWS,
    env: {
      ...process.env,
      POLARIS_LOCAL_RPC: RPC,
      POLARIS_LOCAL_DEPLOYMENT: deploymentFile,
      POLARIS_LOCAL_GUARDIAN_EVERY_MS: "60000",
      POLARIS_LOCAL_GUARDIAN_PRICE: guardianPrice.price,
      POLARIS_MONAD_MAINNET_RPC: MONAD_MAINNET_RPC,
      POLARIS_LOCAL_GUARDIAN_STATUS: join(DEMO, "guardian.json"),
    },
  });

  // ── 4. the Polaris app ─────────────────────────────────────────────────
  const appEnv = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_POLARIS_API_URL: BUSINESS_URL,
    NEXT_PUBLIC_DEV_SIGNER: "1",
    // The dev signer keeps its key for the device (like a passkey), so the shop's checkout popup is the same buyer.
    NEXT_PUBLIC_DEV_SIGNER_PERSIST: "1",
    NEXT_PUBLIC_CHAIN_ID: String(deployment.chainId),
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_EXPLORER_URL: "",
    NEXT_PUBLIC_AUSD_ADDRESS: at("Stablecoin"),
    NEXT_PUBLIC_PAYMENTS_ADDRESS: at("PolarisPayments"),
    NEXT_PUBLIC_CHECKOUT_ADDRESS: at("PolarisCheckout"),
    NEXT_PUBLIC_SEND_ADDRESS: at("PolarisSend"),
    NEXT_PUBLIC_SPLIT_ADDRESS: at("PolarisSplit"),
    NEXT_PUBLIC_LOAN_ENGINE_ADDRESS: at("PolarisLoanEngine"),
    NEXT_PUBLIC_LOCAL_DEMO: "1",
    NEXT_PUBLIC_LOCAL_FAUCET_URL: FAUCET_URL,
    // Nothing live: no Privy ("Continue with email" is hidden), whatever apps/app/.env.local holds.
    NEXT_PUBLIC_PRIVY_APP_ID: "",
  };
  log(`starting the Polaris app on ${APP_URL}…`);
  background("app", process.execPath, [nextBin(APP), "dev", "--port", String(PORTS.app)], { cwd: APP, env: appEnv });

  // ── 5. the demo shop ───────────────────────────────────────────────────
  const shopEnv = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(PORTS.shop),
    POLARIS_API_BASE: BUSINESS_URL,
    POLARIS_SECRET_KEY: seeded.secretKey,
    POLARIS_WEBHOOK_SECRET: seeded.webhookSecret,
    NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY: seeded.publishableKey,
    NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN: APP_URL,
    POLARIS_MERCHANT_ADDRESS: merchant.address,
    SHOP_URL,
    SHOP_DATA_DIR: join(DEMO, "shop"),
    // Direct wallet payments sign for this chain's contracts (development builds only).
    POLARIS_LOCAL_CHAIN: JSON.stringify({
      chainId: deployment.chainId,
      name: "Local Hardhat",
      rpcUrl: RPC,
      explorer: "",
      stablecoin: at("Stablecoin"),
      payments: at("PolarisPayments"),
      loanEngine: at("PolarisLoanEngine"),
      scoreManager: at("ScoreManager"),
      collateralVault: at("CollateralVault"),
      checkout: at("PolarisCheckout"),
      send: at("PolarisSend"),
      merchantRegistry: at("MerchantRegistry"),
      collector: at("CollectionsReceiver"),
      batchSettlement: at("BatchSettlement"),
    }),
  };
  log(`starting Halcyon, the demo shop, on ${SHOP_URL}…`);
  background("shop", process.execPath, [nextBin(SHOP), "dev", "-H", "127.0.0.1", "-p", String(PORTS.shop)], { cwd: SHOP, env: shopEnv });

  // ── 6. the faucet ──────────────────────────────────────────────────────
  await startFaucet(at("Stablecoin"), mint);

  // Wait for everything to answer, warming each app's first page.
  await until("Polaris for Business", async () => {
    const res = await fetch(`${BUSINESS_URL}/api/health`);
    const body = await res.json();
    return res.ok && body.data?.ok === true;
  }, 300_000);
  // Register Halcyon on chain the way the dashboard does after a business is named
  // (useRegisterMerchant): the payout wallet signs the Registration the server
  // prepares, the relayer sends registerFor, and the local registry admin
  // activates it for Pay in 4.
  const registered = await registerMerchant(merchant);
  log(`registered ${MERCHANT_NAME} on MerchantRegistry through /api/merchant/registration: ${registered}`);
  await until("the Polaris app", async () => (await fetch(`${APP_URL}/`)).ok, 300_000);
  await until("the demo shop", async () => (await fetch(`${SHOP_URL}/`)).ok, 300_000);

  // Compile every page and route now, so nobody waits on a first click: the API first (the app's
  // pages call it while they render), with the shop's pages beside it; then the app.
  log("opening every page and API route once so the first click is fast (a few minutes)…");
  const zero = "0x0000000000000000000000000000000000000000";
  const [business, shop] = await Promise.all([
    warm(BUSINESS_URL, [
      ["POST", "/api/public/links/pl_warmupwarmup/checkout", {}],
      "/api/public/sessions/cs_test_warmupwarmup",
      `/api/public/credit/${zero}`,
      `/api/public/credit/${zero}/messages`,
      `/api/public/buyers/${zero}`,
      `/api/public/splits/0x${"0".repeat(64)}`,
      "/api/public/network",
      "/api/public/credit-guard",
      "/api/chainlink",
      ["OPTIONS", "/api/relay"],
      ["POST", "/api/relay", {}],
      ["OPTIONS", "/api/credit/underwrite"],
      ["POST", "/api/credit/underwrite", {}],
      ["POST", "/api/cre/callback", {}],
      ["POST", "/api/webhooks/we_warmup/test", {}],
      "/api/webhooks",
      "/api/overview",
      "/api/payments",
      "/api/plans",
      "/api/links",
      "/api/payouts",
      "/api/keys",
      "/api/me",
      "/api/merchant/registration",
      ["POST", "/api/v1/checkout/sessions", {}],
      "/api/public/merchants/m_warmup",
      "/",
      "/login",
      "/dashboard",
      "/dashboard/payments",
      "/dashboard/links",
      "/dashboard/plans",
      "/dashboard/payouts",
      "/dashboard/developers",
      "/dashboard/settings",
      "/dashboard/chainlink",
    ]),
    warm(SHOP_URL, ["/shop", "/products/halcyon-one", "/cart", "/checkout", "/orders/HC-00000", ["POST", "/api/checkout", {}], "/api/orders/HC-00000", ["POST", "/api/webhooks/polaris", {}]]),
  ]);
  const app = await warm(APP_URL, [
    "/",
    "/onboard",
    "/pay",
    "/pay/pl_warmupwarmup",
    "/pay/cs_test_warmupwarmup",
    "/send",
    "/claim",
    "/split/new",
    `/split/0x${"0".repeat(64)}`,
    "/add",
    "/receive",
    "/activity",
    "/credit",
    "/credit/score",
    "/plans",
    "/plans/0",
    "/cards",
    "/insights",
    "/profile",
    "/notifications",
    "/settings",
    "/accounts",
    "/pay/cs_test_warmupwarmup?display=popup",
    "/api/fx?currency=ARS",
  ]);
  log(`warmed the dashboard and API in ${Math.round(business.ms / 1000)} s, the shop in ${Math.round(shop.ms / 1000)} s, the app in ${Math.round(app.ms / 1000)} s`);

  writeFileSync(
    join(DEMO, "demo.json"),
    JSON.stringify(
      {
        ports: PORTS,
        fastPlans: FAST_PLANS,
        guardian: { price: guardianPrice.price, why: guardianPrice.why, status: join(DEMO, "guardian.json") },
        urls: { business: BUSINESS_URL, dashboard: `${BUSINESS_URL}/dashboard`, app: APP_URL, shop: SHOP_URL, faucet: `${FAUCET_URL}/mint`, rpc: RPC },
        chainId: deployment.chainId,
        contracts: Object.fromEntries(Object.entries(deployment.contracts).map(([k, v]) => [k, v.address])),
        merchant: { address: merchant.address, name: MERCHANT_NAME, publicId: seeded.merchant.publicId, registration: registered },
      },
      null,
      2,
    ),
  );

  console.log(`
Polaris is running locally (chain ${deployment.chainId}; nothing is live, no Privy, no CRE login).

  Demo shop      ${SHOP_URL}             add to the bag, check out with Polaris
  Polaris app    ${APP_URL}              the checkout sheet (dev signer, not Face ID)
  Dashboard      ${BUSINESS_URL}/dashboard   ${MERCHANT_NAME}, signed in locally (registered on chain: ${registered})
  Faucet         POST ${FAUCET_URL}/mint {"address": "0x…"}   (or Add money in the app)
  Chain          ${RPC}

Split a bill: in the app, More (or Split a bill on the desktop) → the bill,
equally or by name → one link; open it in another browser profile to pay a
share (a new visitor creates an account there, then Add money → test
dollars). Every share is PolarisSplit on this chain, relayed.
Pay in 4 needs a credit line: in the checkout, Raise your limit runs the CRE
underwriting workflow locally (sample history from fixtures, not Nansen).
The CRE collections workflow runs every minute and on every Reauthorized
(.demo/logs/cre-collections.log); instalments are ${FAST_PLANS ? "a minute apart (DEMO_FAST_PLANS=1)" : "a week apart (DEMO_FAST_PLANS=1 makes them a minute)"}.
The CRE guardian runs every minute (.demo/logs/cre-guardian.log): ${guardianPrice.why}.
Chainlink scenes: node scripts/demo-chainlink.mjs guard raise | guard restore | lose-approval | status.
Logs: .demo/logs. Ctrl+C stops everything.
`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(`[demo] ${error.message ?? error}`);
  stop();
  process.exit(1);
});
