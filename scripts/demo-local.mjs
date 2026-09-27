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
 *     Add money sheet offers on this chain.
 *
 * Then open http://127.0.0.1:3600, add something to the bag and check out
 * with Polaris. The dashboard is http://localhost:3100/dashboard.
 *
 * Ports: DEMO_NODE_PORT (8545), DEMO_BUSINESS_PORT (3100), DEMO_APP_PORT
 * (3000), DEMO_SHOP_PORT (3600), DEMO_TRIGGER_PORT (2000), DEMO_FAUCET_PORT
 * (3650). State lives in .demo/ (git-ignored) and is fresh on every run.
 * Stop with Ctrl+C; everything started here stops with it.
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

async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
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
process.on("exit", stop);

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
    env: { ...process.env, POLARIS_LOCAL_NODE_PORT: String(PORTS.node), RELAYER_ADDRESS },
  });
  const deploymentFile = join(DEMO, "deployment.json");
  copyFileSync(join(CONTRACTS, "deployments", "monad-local.json"), deploymentFile);
  const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
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
  const seeded = await seedMerchant({
    dbUrl,
    pepper: secrets.pepper,
    wallet: deployment.demo.merchant,
    name: deployment.demo.merchantName,
    webhookUrl: `${SHOP_URL}/api/webhooks/polaris`,
    registration: "active",
  });
  log(`seeded ${deployment.demo.merchantName} (${seeded.merchant.publicId}) with test API keys and a webhook to the shop`);

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
    PAY_IN_4_INTERVAL_SECONDS: "604800",
    CRON_SECRET: secrets.cron,
    CRE_UNDERWRITING_TRIGGER_URL: `http://127.0.0.1:${PORTS.trigger}/trigger`,
    CRE_TRIGGER_MIN_INTERVAL_MS: "2000",
    POLARIS_CRE_CALLBACK_SECRET: secrets.callback,
    POLARIS_LOCAL_SESSION_TOKEN: secrets.session,
    POLARIS_LOCAL_SESSION_WALLET: deployment.demo.merchant,
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION: secrets.session,
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET: deployment.demo.merchant,
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
    NEXT_PUBLIC_LOAN_ENGINE_ADDRESS: at("PolarisLoanEngine"),
    NEXT_PUBLIC_LOCAL_DEMO: "1",
    NEXT_PUBLIC_LOCAL_FAUCET_URL: FAUCET_URL,
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
    POLARIS_MERCHANT_ADDRESS: deployment.demo.merchant,
    SHOP_URL,
    SHOP_DATA_DIR: join(DEMO, "shop"),
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
  await until("the Polaris app", async () => (await fetch(`${APP_URL}/`)).ok, 300_000);
  await until("the demo shop", async () => (await fetch(`${SHOP_URL}/`)).ok, 300_000);

  writeFileSync(
    join(DEMO, "demo.json"),
    JSON.stringify(
      {
        ports: PORTS,
        urls: { business: BUSINESS_URL, dashboard: `${BUSINESS_URL}/dashboard`, app: APP_URL, shop: SHOP_URL, faucet: `${FAUCET_URL}/mint`, rpc: RPC },
        chainId: deployment.chainId,
        contracts: Object.fromEntries(Object.entries(deployment.contracts).map(([k, v]) => [k, v.address])),
        merchant: { address: deployment.demo.merchant, name: deployment.demo.merchantName, publicId: seeded.merchant.publicId },
      },
      null,
      2,
    ),
  );

  console.log(`
Polaris is running locally (chain ${deployment.chainId}; nothing is live, no Privy, no CRE login).

  Demo shop      ${SHOP_URL}             add to the bag, check out with Polaris
  Polaris app    ${APP_URL}              the checkout sheet (dev signer, not Face ID)
  Dashboard      ${BUSINESS_URL}/dashboard   ${deployment.demo.merchantName}, signed in locally
  Faucet         POST ${FAUCET_URL}/mint {"address": "0x…"}   (or Add money in the app)
  Chain          ${RPC}

Pay in 4 needs a credit line: in the checkout, Raise your limit runs the CRE
underwriting workflow locally (sample history from fixtures, not Nansen).
Logs: .demo/logs. Ctrl+C stops everything.
`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(`[demo] ${error.message ?? error}`);
  stop();
  process.exit(1);
});
