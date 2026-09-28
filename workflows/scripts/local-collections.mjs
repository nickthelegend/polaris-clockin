#!/usr/bin/env node
/**
 * The local stand-in for CRE's cron trigger on `polaris-collections`: runs
 * the real collections workflow handler (local/collections.run.ts) on the
 * CRE SDK's test runtime against a local chain, every
 * POLARIS_LOCAL_COLLECTIONS_EVERY_MS (default 60 s), the way a deployed
 * workflow's cron would. `pnpm demo:local` starts it with DEMO_FAST_PLANS=1,
 * when Pay in 4 instalments fall due a minute apart:
 *
 *   pnpm --filter @polaris/cre-workflows collections:local
 *
 * Each run reads the due plans and subscriptions from the chain, collects
 * them through CollectionsReceiver (the deployment's MockKeystoneForwarder
 * delivers the report), and posts the workflow's signed callbacks to the
 * API: `collections.run` when something moved (the API syncs the chain at
 * once, so installment.collected webhooks follow), and a
 * `collections.heartbeat` every run, which the dashboard's Collections card
 * reads. A line per run goes to stdout (demo:local writes it to
 * .demo/logs/cre-collections.log).
 *
 * Environment:
 *   POLARIS_LOCAL_RPC                  the local node (default http://127.0.0.1:8545)
 *   POLARIS_LOCAL_DEPLOYMENT           its deployment record (default packages/contracts/deployments/monad-local.json)
 *   POLARIS_LOCAL_COLLECTIONS_EVERY_MS default 60000
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
import { runBun } from "./bun.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(ROOT, "..");
const RPC = process.env.POLARIS_LOCAL_RPC || "http://127.0.0.1:8545";
const DEPLOYMENT = process.env.POLARIS_LOCAL_DEPLOYMENT || join(REPO, "packages", "contracts", "deployments", "monad-local.json");
const EVERY_MS = Math.max(10_000, Number(process.env.POLARIS_LOCAL_COLLECTIONS_EVERY_MS || 60_000));
const CALLBACK_URL = process.env.POLARIS_CALLBACK_URL || "";
const CALLBACK_SECRET = process.env.POLARIS_CALLBACK_SECRET || "";

const host = new URL(RPC).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`POLARIS_LOCAL_RPC must be a local node (got ${RPC}); the local collections runner never writes to a public chain.`);
  process.exit(1);
}

const log = (msg) => console.log(`${new Date().toISOString()} [cre collections] ${msg}`);

async function mineBlock() {
  await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
}

function runOnce() {
  const dir = mkdtempSync(join(tmpdir(), "polaris-cre-collections-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  writeFileSync(inFile, JSON.stringify({ rpc: RPC, deploymentFile: DEPLOYMENT, callback: CALLBACK_URL ? { url: CALLBACK_URL, secret: CALLBACK_SECRET } : null }));
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

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await mineBlock();
    const { result: r, callbacks } = runOnce();
    const moved = r.tasks.length ? ` ${r.tasks.map((t) => `${t.action} #${t.id}`).join(", ")}` : "";
    log(`${r.status}: ${r.checked} checked, ${r.executed} collected, ${r.skipped} skipped${moved}${r.txHash ? ` tx ${r.txHash}` : ""}`);
    await deliver(callbacks);
  } catch (error) {
    log(`run failed: ${error.message}`);
  } finally {
    running = false;
  }
}

log(`every ${EVERY_MS / 1000} s on ${RPC} (candidates from the chain, reports through the deployment's MockKeystoneForwarder)`);
if (!CALLBACK_URL) log("POLARIS_CALLBACK_URL is not set: collections reach the chain, but the API won't hear about the runs");
void tick();
setInterval(() => void tick(), EVERY_MS);
