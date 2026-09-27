#!/usr/bin/env node
/**
 * A local stand-in for Monad testnet that the CRE workflows can write to:
 *
 *   pnpm --filter @polaris/cre-workflows chain:local
 *
 * 1. Starts a Hardhat node on 127.0.0.1:8620 with chain id 10143
 *    (POLARIS_CRE_LOCAL_PORT to move it; 8620-8629 are this package's).
 * 2. Deploys every Polaris contract with packages/contracts' own deploy
 *    script (MockAUSD and a local MockKeystoneForwarder), exactly as testnet.
 * 3. Plants that forwarder's code at Chainlink's simulation-forwarder address
 *    (0xB9F7…D192, which `cre workflow simulate` writes to for
 *    `monad-testnet`) and points the three receivers at it. The deployer,
 *    whose key is Hardhat's first public test key, stays their simulation
 *    transmitter.
 * 4. Writes workflows/.local/deployment.json and every workflow's
 *    config.local.json (git-ignored). The guardian's reads the local chain's
 *    MockPriceFeed ("AUSD / USD (local mock, not Chainlink)"), so a local
 *    depeg is `setAnswer` on it; staging reads Chainlink's feed on mainnet.
 *
 * Then, from workflows/ (after `cre login`):
 *   cre workflow simulate ./collections -T local-settings --non-interactive --trigger-index 0 --broadcast
 * with CRE_ETH_PRIVATE_KEY set to the key this prints. Nothing touches a public chain.
 *
 * `--once` sets everything up and exits, leaving no node behind (used by e2e-local.mjs,
 * which imports startLocalChain / setUpLocalChain instead).
 */

import { spawn } from "node:child_process";
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { configure, FORWARDERS } from "./configure.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CONTRACTS = join(ROOT, "..", "packages", "contracts");
export const PORT = Number(process.env.POLARIS_CRE_LOCAL_PORT || 8620);
export const RPC_URL = `http://127.0.0.1:${PORT}`;
const HH_CONFIG = join(ROOT, "scripts", "hardhat.cre-local.config.cjs");
const require = createRequire(join(CONTRACTS, "package.json"));
const HARDHAT = join(dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");

/**
 * Hardhat's first default account: a public, well-known test key (it is in
 * Hardhat's docs). Never use it on a public network.
 */
export const LOCAL_TRANSMITTER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const LOCAL_TRANSMITTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function ready() {
  try {
    return (await rpc("eth_chainId")) !== undefined;
  } catch {
    return false;
  }
}

function hardhat(args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARDHAT, ...args, "--config", HH_CONFIG], {
      cwd: CONTRACTS,
      stdio: quiet ? "ignore" : "inherit",
      env: { ...process.env, POLARIS_CRE_LOCAL_PORT: String(PORT) },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`hardhat ${args.join(" ")} exited ${code}`))));
  });
}

/** Start the node; resolves once it answers. Returns the child process. */
export async function startLocalChain() {
  if (await ready()) {
    throw new Error(`Something already answers on ${RPC_URL}. Stop it, or set POLARIS_CRE_LOCAL_PORT (8620-8629).`);
  }
  const logFile = join(tmpdir(), `polaris-cre-hardhat-${PORT}.log`);
  const log = createWriteStream(logFile);
  const node = spawn(process.execPath, [HARDHAT, "node", "--hostname", "127.0.0.1", "--port", String(PORT), "--config", HH_CONFIG], {
    cwd: CONTRACTS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  node.stdout.pipe(log);
  node.stderr.pipe(log);
  const started = Date.now();
  while (!(await ready())) {
    if (node.exitCode !== null) throw new Error(`hardhat node exited ${node.exitCode} (log: ${logFile})`);
    if (Date.now() - started > 180_000) throw new Error(`hardhat node did not start within 3 minutes (log: ${logFile})`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const chainId = Number.parseInt(await rpc("eth_chainId"), 16);
  if (chainId !== 10143) throw new Error(`expected chain id 10143, the node says ${chainId}`);
  return { node, logFile };
}

const RECEIVER_ADMIN = parseAbi(["function setForwarderAddress(address forwarder)"]);
/** The three CRE receivers, each repointed at the planted simulation forwarder. */
export const RECEIVERS = ["CollectionsReceiver", "UnderwritingReceiver", "GuardianReceiver"];
const setForwarderData = (addr) => encodeFunctionData({ abi: RECEIVER_ADMIN, functionName: "setForwarderAddress", args: [addr] });

/** Deploy, plant the simulation forwarder, write the local configs. */
export async function setUpLocalChain() {
  await hardhat(["compile", "--quiet"], { quiet: true });
  await hardhat(["run", "scripts/deploy-monad.js", "--network", "monadLocal"]);
  const dir = join(ROOT, ".local");
  mkdirSync(dir, { recursive: true });
  const deploymentFile = join(dir, "deployment.json");
  copyFileSync(join(CONTRACTS, "deployments", "monad-local.json"), deploymentFile);
  const record = JSON.parse(readFileSync(deploymentFile, "utf8"));

  // Chainlink's simulation forwarder address, with our local mock's code.
  const localForwarder = record.contracts.MockKeystoneForwarder?.address ?? record.cre.forwarder;
  const code = await rpc("eth_getCode", [localForwarder, "latest"]);
  if (!code || code === "0x") throw new Error(`no forwarder code at ${localForwarder}`);
  await rpc("hardhat_setCode", [FORWARDERS.simulation, code]);
  for (const name of RECEIVERS) {
    const hash = await rpc("eth_sendTransaction", [
      { from: record.deployer, to: record.contracts[name].address, data: setForwarderData(FORWARDERS.simulation) },
    ]);
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt?.status !== "0x1") throw new Error(`${name}.setForwarderAddress failed`);
  }
  record.cre.localForwarder = localForwarder;
  record.cre.forwarder = FORWARDERS.simulation;
  writeFileSync(deploymentFile, `${JSON.stringify(record, null, 2)}\n`);

  const { written } = configure("local", { deployment: deploymentFile });
  return { record, deploymentFile, configs: written };
}

async function main() {
  const once = process.argv.includes("--once");
  const { node, logFile } = await startLocalChain();
  let ok = false;
  try {
    const { record, configs } = await setUpLocalChain();
    ok = true;
    console.log(`\nLocal Monad stand-in on ${RPC_URL} (chain 10143), node log: ${logFile}`);
    console.log(`Simulation forwarder planted at ${FORWARDERS.simulation}; receivers repointed.`);
    for (const name of RECEIVERS) console.log(`${name.padEnd(22)}${record.contracts[name].address}`);
    if (record.contracts.MockAusdUsdFeed) console.log(`MockAusdUsdFeed       ${record.contracts.MockAusdUsdFeed.address} (local mock, not Chainlink)`);
    for (const c of configs) console.log(`Wrote ${c}`);
    console.log(`\nFor \`cre workflow simulate -T local-settings --broadcast\`, put this public Hardhat test key in workflows/.env:`);
    console.log(`  CRE_ETH_PRIVATE_KEY=${LOCAL_TRANSMITTER_KEY.slice(2)}   # ${LOCAL_TRANSMITTER}, the receivers' simulation transmitter`);
    if (once) return;
    console.log("\nCtrl+C stops the node.");
    await new Promise((resolve) => node.on("exit", resolve));
  } finally {
    if (once || !ok) node.kill();
  }
}

if (process.argv[1] && /local-chain\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
