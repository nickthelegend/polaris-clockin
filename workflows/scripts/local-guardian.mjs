#!/usr/bin/env node
/**
 * The local stand-in for CRE's cron trigger on `polaris-guardian`, on a
 * local chain:
 *
 *   pnpm --filter @polaris/cre-workflows guardian:local
 *
 * Every POLARIS_LOCAL_GUARDIAN_EVERY_MS (default 60 s, staging's "every
 * minute", on the minute) it runs the real
 * workflow's `onCron` (local/guardian.run.ts) on the CRE SDK's test
 * runtime: PolarisLoanEngine's pool figures and the owner's thresholds from
 * GuardianReceiver on the local chain; AUSD/USD from Chainlink's Data Feed
 * on Monad MAINNET over its public RPC (reads only; POLARIS_LOCAL_GUARDIAN_PRICE=mock
 * reads the local chain's labelled MockAusdUsdFeed instead, for offline
 * runs); the verdict; and, when it says something new, the signed
 * attestation through the deployment's MockKeystoneForwarder.
 * GuardianReceiver re-evaluates it, and PolarisCheckout.openPlan refuses
 * new Pay in 4 plans while it says "paused".
 *
 * A line per run goes to stdout (demo:local writes it to
 * .demo/logs/cre-guardian.log), and the latest result to
 * POLARIS_LOCAL_GUARDIAN_STATUS (a JSON file), which demo scripts read.
 *
 * Environment:
 *   POLARIS_LOCAL_RPC                the local node (default http://127.0.0.1:8545)
 *   POLARIS_LOCAL_DEPLOYMENT         its deployment record (default packages/contracts/deployments/monad-local.json)
 *   POLARIS_LOCAL_GUARDIAN_EVERY_MS  default 60000
 *   POLARIS_LOCAL_GUARDIAN_PRICE     mainnet (default) or mock
 *   POLARIS_MONAD_MAINNET_RPC        default https://rpc.monad.xyz
 *   POLARIS_LOCAL_GUARDIAN_STATUS    where to keep the latest result (optional)
 *
 * Local chains only: it refuses an RPC that isn't on loopback, and the
 * mainnet bridge cannot write.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBun } from "./bun.mjs";

const RPC = process.env.POLARIS_LOCAL_RPC || "http://127.0.0.1:8545";
const DEPLOYMENT = process.env.POLARIS_LOCAL_DEPLOYMENT || join(import.meta.dirname, "..", "..", "packages", "contracts", "deployments", "monad-local.json");
const EVERY_MS = Math.max(10_000, Number(process.env.POLARIS_LOCAL_GUARDIAN_EVERY_MS || 60_000));
const PRICE = process.env.POLARIS_LOCAL_GUARDIAN_PRICE || "mainnet";
const MAINNET_RPC = process.env.POLARIS_MONAD_MAINNET_RPC || "https://rpc.monad.xyz";
const STATUS = process.env.POLARIS_LOCAL_GUARDIAN_STATUS || "";

const log = (msg) => console.log(`${new Date().toISOString()} [cre guardian] ${msg}`);

const host = new URL(RPC).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`POLARIS_LOCAL_RPC must be a local node (got ${RPC}); the local guardian runner never writes to a public chain.`);
  process.exit(1);
}
if (!["mainnet", "mock"].includes(PRICE)) {
  console.error(`POLARIS_LOCAL_GUARDIAN_PRICE is mainnet or mock (got ${PRICE})`);
  process.exit(1);
}

async function mineBlock() {
  await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }) });
}

function runOnce() {
  const dir = mkdtempSync(join(tmpdir(), "polaris-cre-guardian-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  writeFileSync(inFile, JSON.stringify({ rpc: RPC, deploymentFile: DEPLOYMENT, everySeconds: Math.round(EVERY_MS / 1000), price: PRICE, mainnetRpc: MAINNET_RPC }));
  try {
    const r = runBun(["--conditions=source", "test", "--timeout", "120000", "./local/guardian.run.ts"], {
      env: { ...process.env, LOCAL_GUARDIAN_IN: inFile, LOCAL_GUARDIAN_OUT: outFile },
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

/** One line for a run: the price and where it came from, the verdict, and what was written. */
export function describeRun(r) {
  const price = `${r.price.kind === "chainlink" ? "Chainlink" : "mock"} ${r.price.description} ${r.price.answer} (round ${r.price.roundId}, ${r.price.ageSeconds} s old)`;
  const verdict = r.verdict.creditPaused ? `PAUSE Pay in 4 (${r.verdict.reasonNames.join(", ")})` : "healthy";
  const wrote = r.status === "written" ? `wrote round ${r.round}, tx ${r.txHash}` : r.status === "refused" ? `refused: ${r.refusal}, tx ${r.txHash}` : `no write (${r.why})`;
  return `${price}; min ${r.thresholds.minPrice}; ${verdict}; ${r.transition}; ${wrote}`;
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await mineBlock();
    const out = runOnce();
    const at = new Date().toISOString();
    log(describeRun(out.result));
    if (out.result.note) log(`note: ${out.result.note}`);
    if (STATUS) writeFileSync(STATUS, JSON.stringify({ at, ...out }, null, 2));
  } catch (error) {
    log(`run failed: ${error.message}`);
  } finally {
    running = false;
  }
}

if (process.argv[1] && /local-guardian\.mjs$/.test(process.argv[1])) {
  log(`every ${EVERY_MS / 1000} s on ${RPC}; AUSD/USD from ${PRICE === "mainnet" ? `Chainlink's Data Feed on Monad mainnet (${MAINNET_RPC}, reads only)` : "the local MockAusdUsdFeed (labelled mock, not Chainlink)"}`);
  void tick();
  // Then on the schedule's own beats (every minute on the minute, as the cron "0 * * * * *").
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), EVERY_MS);
  }, EVERY_MS - (Date.now() % EVERY_MS));
}
