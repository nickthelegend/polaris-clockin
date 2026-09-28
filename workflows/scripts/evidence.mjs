#!/usr/bin/env node
/**
 * The CRE bounty's evidence in one command: each workflow run once with
 * `cre workflow simulate --broadcast` against Monad testnet, its log and
 * transaction hashes kept, and every hash checked on chain.
 *
 *   pnpm --filter @polaris/cre-workflows evidence
 *   pnpm --filter @polaris/cre-workflows evidence --only collections,guardian
 *   pnpm --filter @polaris/cre-workflows evidence --deployment <file> --target staging-settings
 *   pnpm --filter @polaris/cre-workflows evidence --only collections --retry-tx <reauthorize tx hash>
 *
 * In order:
 *   1. `cre whoami`: refuses unless logged in (`cre login`, or CRE_API_KEY).
 *   2. The deployment record (packages/contracts/deployments/monad-testnet.json):
 *      refuses without one, or without the addresses a workflow needs, or
 *      on any chain but Monad testnet (10143). Nothing here writes to mainnet.
 *   3. The transmitter: CRE_ETH_PRIVATE_KEY (workflows/.env or the shell) must
 *      be set, hold testnet MON, and be every receiver's simulationTransmitter
 *      (collections, underwriting, guardian), or its reports would revert.
 *      Only its address is ever printed.
 *   4. `configure staging` from that record, so the configs hold its addresses
 *      (commit them: they are public): all three workflows, the retry's
 *      PolarisCheckout, the guardian's Chainlink AUSD/USD on Monad mainnet.
 *   5. `cre workflow supported-chains`, kept as the organisation's view of
 *      Monad testnet and mainnet.
 *   6. Each workflow: `cre workflow simulate <dir> -T <target> --non-interactive
 *      --trigger-index 0 --broadcast` (underwriting with a freshly signed
 *      payload, scripts/underwriting-payload.mjs). A cron workflow fires at its
 *      next scheduled tick, so a run can wait up to a minute. With
 *      `--retry-tx <hash>` (a PolarisCheckout.reauthorize transaction on
 *      Monad testnet), collections' EVM log trigger too: `--trigger-index 1
 *      --evm-tx-hash <hash> --evm-event-index <i>`, where i is the position of
 *      its `Reauthorized` log in that receipt, read from the chain.
 *   7. Every transaction hash in the result and the logs is read back from
 *      Monad testnet: landed or reverted, its block, and what the forwarder's
 *      ReportProcessed said about the receiver.
 *
 * Output: workflows/evidence/<UTC date>/<time>-<workflow>.log (the CLI's
 * output, secrets redacted), runs.json (every run of that date) and README.md
 * (the table, also printed). A run that wrote nothing (nothing due, a thin
 * file) is recorded as it is: no transaction is ever invented.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { configure } from "./configure.mjs";
import {
  markdownTable,
  MONAD_TESTNET,
  NOT_LOGGED_IN,
  outcomeOf,
  parseSimulation,
  readDeployment,
  readWhoami,
  redact,
  ROOT,
  rpc,
  runCreCaptured,
  simulationEnv,
  verifyTx,
} from "./sim.mjs";

export const DEFAULT_DEPLOYMENT = join(ROOT, "..", "packages", "contracts", "deployments", "monad-testnet.json");
export const EVIDENCE_DIR = join(ROOT, "evidence");

/** What each workflow needs from the deployment, and how its trigger is fired. */
export const WORKFLOWS = {
  collections: {
    dir: "./collections",
    trigger: "cron",
    receiver: "CollectionsReceiver",
    // PolarisCheckout: the instant retry's log trigger listens to its Reauthorized.
    contracts: ["CollectionsReceiver", "PolarisLoanEngine", "PolarisPayments", "PolarisCheckout"],
  },
  underwriting: { dir: "./underwriting", trigger: "http", receiver: "UnderwritingReceiver", contracts: ["UnderwritingReceiver", "ScoreManager", "Stablecoin"] },
  guardian: { dir: "./guardian", trigger: "cron", receiver: "GuardianReceiver", contracts: ["GuardianReceiver"] },
};

/** keccak256("Reauthorized(address,uint256,uint256)"): PolarisCheckout's re-sign event, collections' trigger 1. */
export const REAUTHORIZED_TOPIC = "0xd76c9fffb0eee17b94b2c5c485c1dcadfb48e50f9089e879e50c163b8ce02d73";

/**
 * The `--evm-event-index` for a reauthorize transaction: the position of
 * PolarisCheckout's `Reauthorized` among the receipt's logs (the token's
 * `Approval` from the permit comes first), or -1 when it has none.
 */
export function reauthorizedLogIndex(receipt, checkout) {
  return (receipt?.logs ?? []).findIndex(
    (l) => (l.address ?? "").toLowerCase() === checkout.toLowerCase() && (l.topics?.[0] ?? "").toLowerCase() === REAUTHORIZED_TOPIC,
  );
}

/** The CLI arguments for one evidence run. `retry` = { txHash, eventIndex } runs collections' log trigger. */
export function simulateArgs(w, target, retry = null) {
  const spec = WORKFLOWS[w];
  if (retry) {
    return ["workflow", "simulate", spec.dir, "-T", target, "--non-interactive", "--trigger-index", "1", "--evm-tx-hash", retry.txHash, "--evm-event-index", String(retry.eventIndex), "--broadcast"];
  }
  const args = ["workflow", "simulate", spec.dir, "-T", target, "--non-interactive", "--trigger-index", "0", "--broadcast"];
  if (spec.trigger === "http") args.push("--http-payload", "./underwriting/payload.json");
  return args;
}

const TARGETS = { "staging-settings": "staging", "local-settings": "local" };

const SIMULATION_TRANSMITTER_CALL = encodeFunctionData({
  abi: parseAbi(["function simulationTransmitter() view returns (address)"]),
  functionName: "simulationTransmitter",
});

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/**
 * Everything that must hold before a single transaction is sent. Returns the
 * reasons to refuse (empty when ready). Pure but for the file reads it is given.
 */
export function preflight({ whoami, deployment, deploymentFile, target, workflows, env, retryTx = null }) {
  const problems = [];
  if (retryTx !== null && !/^0x[0-9a-fA-F]{64}$/.test(retryTx)) problems.push("--retry-tx must be a transaction hash (0x and 64 hex characters).");
  if (retryTx !== null && !workflows.includes("collections")) problems.push("--retry-tx runs collections' log trigger: include collections.");
  if (!whoami.loggedIn) problems.push(NOT_LOGGED_IN);
  if (!TARGETS[target]) problems.push(`target "${target}" is not one this script broadcasts to: use staging-settings (Monad testnet) or local-settings`);
  if (!deployment) {
    problems.push(
      `No deployment record at ${deploymentFile}: deploy the contracts first (\`pnpm --filter @polarispay/contracts deploy:monad\`), or pass --deployment <file>.`,
    );
  } else {
    if (target === "staging-settings" && Number(deployment.chainId) !== MONAD_TESTNET.chainId) {
      problems.push(`The deployment is on chain ${deployment.chainId}, not Monad testnet (${MONAD_TESTNET.chainId}): this script never writes anywhere else.`);
    }
    for (const w of workflows) {
      for (const c of WORKFLOWS[w].contracts) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.contracts?.[c]?.address ?? "")) problems.push(`The deployment has no ${c} address, which ${w} needs.`);
      }
    }
  }
  const key = env.CRE_ETH_PRIVATE_KEY?.trim();
  if (!key) {
    problems.push("CRE_ETH_PRIVATE_KEY is not set (workflows/.env or the shell): the key `simulate --broadcast` signs with, a dedicated testnet key, never the deployer's.");
  } else if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    problems.push("CRE_ETH_PRIVATE_KEY is not 32 bytes of hex.");
  }
  return problems;
}

/** The transmitter's address from CRE_ETH_PRIVATE_KEY, never the key. */
export function transmitterAddress(key) {
  return privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`).address;
}

function workflowsToRun() {
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const present = Object.keys(WORKFLOWS).filter((w) => existsSync(join(ROOT, WORKFLOWS[w].dir, "workflow.yaml")));
  if (!only) return present;
  const unknown = only.filter((w) => !present.includes(w));
  if (unknown.length > 0) throw new Error(`no such workflow here: ${unknown.join(", ")} (have ${present.join(", ")})`);
  return only;
}

function writePayload(env) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--conditions=source", join(ROOT, "scripts", "underwriting-payload.mjs")],
    { cwd: ROOT, env, encoding: "utf8" },
  );
  process.stdout.write(redact(`${r.stdout ?? ""}${r.stderr ?? ""}`, env));
  if (r.status !== 0) throw new Error("could not write underwriting/payload.json");
}

const stamp = (d) => d.toISOString().slice(11, 19).replace(/:/g, "");

async function main() {
  const target = arg("target") ?? "staging-settings";
  const deploymentFile = arg("deployment") ?? DEFAULT_DEPLOYMENT;
  const retryTx = arg("retry-tx") ?? null;
  const env = simulationEnv();
  const workflows = workflowsToRun();

  console.log("CRE evidence: checking the login, the deployment and the transmitter before sending anything.\n");
  const whoami = readWhoami(await runCreCaptured(["whoami"], { env, echo: false, timeoutMs: 60_000 }));
  const deployment = readDeployment(deploymentFile);
  const problems = preflight({ whoami, deployment, deploymentFile, target, workflows, env, retryTx });
  if (problems.length > 0) {
    console.error("Refusing to run: nothing was sent.\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 2;
    return;
  }

  const transmitter = transmitterAddress(env.CRE_ETH_PRIVATE_KEY.trim());
  const rpcUrl = target === "staging-settings" ? MONAD_TESTNET.rpc : "http://127.0.0.1:8620";
  const balance = BigInt(await rpc(rpcUrl, "eth_getBalance", [transmitter, "latest"]));
  console.log(`Transmitter ${transmitter}: ${Number(balance) / 1e18} MON on ${target}`);
  const refuse = [];
  if (balance === 0n) refuse.push(`The transmitter ${transmitter} holds no MON on ${target}: fund it (1-2 testnet MON), then run this again.`);
  // A receiver that guards simulated deliveries by origin reverts every report another key sends.
  for (const w of workflows) {
    const name = WORKFLOWS[w].receiver;
    const at = deployment.contracts?.[name]?.address;
    if (!at) continue;
    let raw;
    try {
      raw = await rpc(rpcUrl, "eth_call", [{ to: at, data: SIMULATION_TRANSMITTER_CALL }, "latest"]);
    } catch {
      continue; // no simulationTransmitter(): no origin check
    }
    if (typeof raw !== "string" || raw.length < 66) continue;
    const expected = `0x${raw.slice(26, 66)}`;
    console.log(`${name}.simulationTransmitter() = ${expected}`);
    if (!/^0x0{40}$/.test(expected) && expected.toLowerCase() !== transmitter.toLowerCase()) {
      refuse.push(`${name} only accepts reports sent by ${expected}, not ${transmitter}: set CRE_ETH_PRIVATE_KEY to that key (or have the owner call setSimulationTransmitter).`);
    }
  }
  // The log trigger's payload is a real Reauthorized log: find it in that transaction's receipt.
  let retry = null;
  if (retryTx) {
    const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [retryTx]);
    const checkout = deployment.contracts.PolarisCheckout.address;
    const eventIndex = reauthorizedLogIndex(receipt, checkout);
    if (!receipt) refuse.push(`--retry-tx ${retryTx} is not a transaction on ${target}.`);
    else if (eventIndex < 0) refuse.push(`${retryTx} has no Reauthorized log from PolarisCheckout ${checkout}: send PolarisCheckout.reauthorize first.`);
    else {
      retry = { txHash: retryTx, eventIndex };
      console.log(`Reauthorized is log ${eventIndex} of ${retryTx}: collections' trigger 1 will fire on it`);
    }
  }
  if (refuse.length > 0) {
    console.error("\nRefusing to run: nothing was sent.\n");
    for (const p of refuse) console.error(`  - ${p}`);
    process.exitCode = 2;
    return;
  }

  // The configs from the record (collections and underwriting); the rest stay as they are.
  const { written } = configure(TARGETS[target], { deployment: deploymentFile });
  console.log(`Configs filled from ${deploymentFile}:\n${written.map((f) => `  ${f}`).join("\n")}`);

  const day = new Date();
  const dir = join(EVIDENCE_DIR, day.toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });

  const chains = await runCreCaptured(["workflow", "supported-chains"], { env, echo: false, timeoutMs: 60_000 });
  writeFileSync(join(dir, "supported-chains.txt"), redact(chains.output, env));
  if (whoami.deployAccess) console.log(`Deploy access: ${whoami.deployAccess}`);

  const runsFile = join(dir, "runs.json");
  const runs = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, "utf8")) : [];
  const fresh = [];
  const planned = [...workflows.map((w) => ({ w, label: w, retry: null })), ...(retry ? [{ w: "collections", label: "collections-retry", retry }] : [])];
  for (const { w, label, retry: r } of planned) {
    const spec = WORKFLOWS[w];
    console.log(`\n── ${label} (${r ? "EVM log trigger: Reauthorized" : `${spec.trigger} trigger`}) ─────────────────────────────────────`);
    if (spec.trigger === "http" && !r) writePayload(env);
    const args = simulateArgs(w, target, r);
    const at = new Date();
    const run = await runCreCaptured(args, { env });
    const parsed = parseSimulation(run.output);
    const log = `${label}-${stamp(at)}.log`;
    writeFileSync(join(dir, log), `$ cre ${args.join(" ")}\n# exit ${run.code}, ${at.toISOString()}\n\n${redact(run.output, env)}`);
    const txs = [];
    for (const hash of parsed.txHashes) {
      const tx = await verifyTx(hash, { url: rpcUrl });
      if (tx) txs.push(tx);
    }
    const row = { at: at.toISOString(), workflow: label, target, exitCode: run.code, outcome: outcomeOf(parsed, run.code), result: parsed.result, log, txs };
    fresh.push(row);
    runs.push(row);
  }
  writeFileSync(runsFile, `${JSON.stringify(runs, null, 2)}\n`);

  const rows = (list) => list.flatMap((r) => (r.txs.length === 0 ? [{ ...r, tx: null }] : r.txs.map((tx) => ({ ...r, tx }))));
  const table = markdownTable(rows(runs));
  writeFileSync(
    join(dir, "README.md"),
    `# CRE runs on ${dir.slice(-10)}\n\nEach row is one \`cre workflow simulate --broadcast\` run (CRE CLI v1.35.0), with its log in this folder and its transaction read back from Monad testnet. "Delivered" is the forwarder's ReportProcessed result for the receiver.\n\n${table}\n`,
  );
  console.log(`\n${markdownTable(rows(fresh))}\n\nLogs and runs.json: ${dir}`);
  if (fresh.some((r) => r.exitCode !== 0)) process.exitCode = 1;
}

if (process.argv[1] && /evidence\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
