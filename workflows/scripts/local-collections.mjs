#!/usr/bin/env node
/**
 * The local stand-in for CRE's two triggers on `polaris-collections`, on a
 * local chain:
 *
 *   pnpm --filter @polaris/cre-workflows collections:local
 *
 * - the cron: every POLARIS_LOCAL_COLLECTIONS_EVERY_MS (default 60 s, on the
 *   minute, as staging's "0 * * * * *") it
 *   runs the real workflow's `onCron` (local/collections.run.ts) on the CRE
 *   SDK's test runtime: due instalments and renewals are read from the
 *   chain and collected through CollectionsReceiver (the deployment's
 *   MockKeystoneForwarder delivers the report);
 * - the EVM log trigger (the instant retry): every second it asks the node
 *   for PolarisCheckout's `Reauthorized` logs, and runs the workflow's
 *   `onReauthorized` on each one, handed that log from the transaction's
 *   receipt, the way the DON hands it over. A buyer who signs again after a
 *   lost approval is collected in the next block, not at the next rung of
 *   the dunning ladder (6 h). POLARIS_LOCAL_RETRY=0 turns it off, as
 *   `retry: null` does in a deployed config.
 *
 * Runs are one at a time, in the order they were triggered. Each run posts
 * the workflow's signed callbacks to the API: `collections.run` when
 * something moved or failed (the API syncs the chain at once, so
 * installment.collected webhooks follow), and, for a cron run, a
 * `collections.heartbeat`, which the dashboard's Collections card reads.
 * A line per run goes to stdout (demo:local writes it to
 * .demo/logs/cre-collections.log).
 *
 * `pnpm demo:local` starts it; with DEMO_FAST_PLANS=1 Pay in 4 instalments
 * fall due a minute apart, so a collection plays on camera.
 *
 * Environment:
 *   POLARIS_LOCAL_RPC                  the local node (default http://127.0.0.1:8545)
 *   POLARIS_LOCAL_DEPLOYMENT           its deployment record (default packages/contracts/deployments/monad-local.json)
 *   POLARIS_LOCAL_COLLECTIONS_EVERY_MS default 60000
 *   POLARIS_LOCAL_RETRY                0 to run on the cron alone
 *   POLARIS_CALLBACK_URL               where callbacks go (e.g. http://localhost:3100/api/cre/callback)
 *   POLARIS_CALLBACK_SECRET            their HMAC secret (= the API's POLARIS_CRE_CALLBACK_SECRET)
 *
 * Local chains only: it refuses an RPC that isn't on loopback. Before each
 * run it mines an empty block, so the chain's clock (the DON's clock here)
 * is now.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toEventSelector } from "viem";
import { runBun } from "./bun.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(ROOT, "..");
const RPC = process.env.POLARIS_LOCAL_RPC || "http://127.0.0.1:8545";
const DEPLOYMENT = process.env.POLARIS_LOCAL_DEPLOYMENT || join(REPO, "packages", "contracts", "deployments", "monad-local.json");
const EVERY_MS = Math.max(10_000, Number(process.env.POLARIS_LOCAL_COLLECTIONS_EVERY_MS || 60_000));
const RETRY = process.env.POLARIS_LOCAL_RETRY !== "0";
const CALLBACK_URL = process.env.POLARIS_CALLBACK_URL || "";
const CALLBACK_SECRET = process.env.POLARIS_CALLBACK_SECRET || "";

/** PolarisCheckout's Reauthorized(address indexed buyer, uint256 value, uint256 deadline): the log trigger's topic0. */
const REAUTHORIZED_TOPIC = toEventSelector("Reauthorized(address,uint256,uint256)");

const log = (msg) => console.log(`${new Date().toISOString()} [cre collections] ${msg}`);

async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** One workflow run with `trigger`, in a Bun test process; its result, writes and callbacks. */
function runOnce(trigger) {
  const dir = mkdtempSync(join(tmpdir(), "polaris-cre-collections-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  writeFileSync(
    inFile,
    JSON.stringify({
      rpc: RPC,
      deploymentFile: DEPLOYMENT,
      callback: CALLBACK_URL ? { url: CALLBACK_URL, secret: CALLBACK_SECRET } : null,
      everySeconds: Math.round(EVERY_MS / 1000),
      trigger,
    }),
  );
  try {
    const r = runBun(["--conditions=source", "test", "--timeout", "120000", "./local/collections.run.ts"], {
      env: { ...process.env, LOCAL_COLLECTIONS_IN: inFile, LOCAL_COLLECTIONS_OUT: outFile },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    let out = null;
    try {
      out = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      // no result: the run failed before writing one
    }
    if (!out) {
      const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-25).join("\n");
      throw new Error(`the workflow run failed (bun exit ${r.status}):\n${tail}`);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deliver(callbacks) {
  for (const c of callbacks) {
    try {
      const res = await fetch(c.url, {
        method: "POST",
        headers: { "content-type": "application/json", "polaris-signature": c.signature },
        body: c.body,
        signal: AbortSignal.timeout(10_000),
      });
      const type = JSON.parse(c.body).type;
      if (type !== "collections.heartbeat" || res.status >= 300) log(`callback ${type} -> ${res.status}`);
    } catch (error) {
      log(`callback to ${c.url} failed: ${error.message}`);
    }
  }
}

/** Runs happen one at a time, in trigger order. */
let queue = Promise.resolve();
let cronQueued = false;

function enqueue(label, trigger) {
  queue = queue.then(async () => {
    try {
      await rpc("evm_mine");
      const { result: r, callbacks } = runOnce(trigger);
      const moved = r.tasks.length ? ` ${r.tasks.map((t) => `${t.action} #${t.id}`).join(", ")}` : "";
      log(`${label} ${r.status}: ${r.checked} checked, ${r.executed} collected, ${r.skipped} skipped${moved}${r.txHash ? ` tx ${r.txHash}` : ""}`);
      await deliver(callbacks);
    } catch (error) {
      log(`${label} run failed: ${error.message}`);
    }
  });
  return queue;
}

function cronTick() {
  if (cronQueued) return;
  cronQueued = true;
  void enqueue("cron", { kind: "cron" }).finally(() => {
    cronQueued = false;
  });
}

/** The log trigger: new Reauthorized logs from PolarisCheckout since the last look. */
async function watchReauthorized(checkout) {
  let from = BigInt(await rpc("eth_blockNumber")) + 1n;
  const seen = new Set();
  setInterval(async () => {
    try {
      const head = BigInt(await rpc("eth_blockNumber"));
      if (head < from) return;
      const logs = await rpc("eth_getLogs", [{ address: checkout, topics: [REAUTHORIZED_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }]);
      from = head + 1n;
      for (const l of logs) {
        const key = `${l.transactionHash}:${l.logIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const buyer = `0x${l.topics[1].slice(26)}`;
        log(`log trigger: Reauthorized from ${buyer} in ${l.transactionHash}`);
        void enqueue("log", { kind: "log", txHash: l.transactionHash });
      }
    } catch (error) {
      log(`log trigger: ${error.message}`);
    }
  }, 1000);
}

const host = new URL(RPC).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`POLARIS_LOCAL_RPC must be a local node (got ${RPC}); the local collections runner never writes to a public chain.`);
  process.exit(1);
}
const deployment = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
log(`cron every ${EVERY_MS / 1000} s on ${RPC} (candidates from the chain, reports through the deployment's MockKeystoneForwarder)`);
if (!CALLBACK_URL) log("POLARIS_CALLBACK_URL is not set: collections reach the chain, but the API won't hear about the runs");
if (RETRY) {
  const checkout = deployment.contracts?.PolarisCheckout?.address;
  if (!checkout) throw new Error("the deployment has no PolarisCheckout: no Reauthorized to listen for");
  log(`log trigger on PolarisCheckout ${checkout} Reauthorized (${REAUTHORIZED_TOPIC})`);
  await watchReauthorized(checkout);
}
cronTick();
// Then on the schedule's own beats (every minute on the minute, as the cron "0 * * * * *").
setTimeout(() => {
  cronTick();
  setInterval(cronTick, EVERY_MS);
}, EVERY_MS - (Date.now() % EVERY_MS));
