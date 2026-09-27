#!/usr/bin/env node
/**
 * The local fallback for CRE's HTTP trigger, for when the CRE CLI isn't
 * logged in (`cre whoami` says so) or a run should stay on this machine:
 *
 *   pnpm --filter @polaris/cre-workflows trigger:local
 *
 * It listens where `cre workflow simulate ./underwriting --listen` would
 * (POST http://127.0.0.1:2000/trigger, body `{ "input": <payload> }`), so
 * Polaris for Business fires it exactly as it fires the CLI:
 * CRE_UNDERWRITING_TRIGGER_URL=http://127.0.0.1:2000/trigger. Each request
 * runs the real `polaris-underwrite` handler (local/underwrite.run.ts) on the
 * CRE SDK's test runtime with Bun:
 *
 * - the account's consent and the history wallet's proof are verified;
 * - the facts are derived by @polarispay/underwriting from its synthesized
 *   provider fixtures: the account gets the "fresh-account" persona's
 *   history and the linked wallet the "strong" one's (no keys, no network,
 *   and the run's log says so);
 * - the report goes through the local chain's MockKeystoneForwarder, and
 *   ScoreManager scores it and opens the line on chain;
 * - the workflow's signed callback is posted to the API.
 *
 * Environment:
 *   POLARIS_LOCAL_RPC             the local node (default http://127.0.0.1:8545)
 *   POLARIS_LOCAL_DEPLOYMENT      its deployment record (default packages/contracts/deployments/monad-local.json)
 *   POLARIS_LOCAL_TRIGGER_PORT    default 2000
 *   POLARIS_CALLBACK_URL          where the callback goes (e.g. http://localhost:3100/api/cre/callback)
 *   POLARIS_CALLBACK_SECRET       its HMAC secret (= the API's POLARIS_CRE_CALLBACK_SECRET)
 *   POLARIS_LOCAL_ACCOUNT_PERSONA / POLARIS_LOCAL_HISTORY_PERSONA
 *                                 fixture personas (default fresh-account / strong)
 *
 * Local chains only: it refuses an RPC that isn't on loopback, and it holds
 * no key (the node's unlocked deployer account delivers the report, as the
 * CRE simulator's transmitter key would).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBun } from "./bun.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(ROOT, "..");
const RPC = process.env.POLARIS_LOCAL_RPC || "http://127.0.0.1:8545";
const DEPLOYMENT = process.env.POLARIS_LOCAL_DEPLOYMENT || join(REPO, "packages", "contracts", "deployments", "monad-local.json");
const PORT = Number(process.env.POLARIS_LOCAL_TRIGGER_PORT || 2000);
const CALLBACK_URL = process.env.POLARIS_CALLBACK_URL || "";
const CALLBACK_SECRET = process.env.POLARIS_CALLBACK_SECRET || "";

const PERSONAS = JSON.parse(readFileSync(join(REPO, "packages", "underwriting", "fixtures", "personas.json"), "utf8"));
function persona(kind, name) {
  const found = PERSONAS[kind].find((p) => p.persona === name);
  if (!found) throw new Error(`No ${kind} persona "${name}" in packages/underwriting/fixtures/personas.json`);
  return found.address;
}
const ACCOUNT_PERSONA = process.env.POLARIS_LOCAL_ACCOUNT_PERSONA || "fresh-account";
const HISTORY_PERSONA = process.env.POLARIS_LOCAL_HISTORY_PERSONA || "strong";

const host = new URL(RPC).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`POLARIS_LOCAL_RPC must be a local node (got ${RPC}); the local trigger never writes to a public chain.`);
  process.exit(1);
}

const log = (msg) => console.log(`[cre local] ${msg}`);

/** Run the workflow handler once, in Bun, and read what it did. */
function runOnce(input) {
  const dir = mkdtempSync(join(tmpdir(), "polaris-cre-trigger-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  writeFileSync(
    inFile,
    JSON.stringify({
      rpc: RPC,
      deploymentFile: DEPLOYMENT,
      callback: CALLBACK_URL ? { url: CALLBACK_URL, secret: CALLBACK_SECRET } : null,
      personas: { account: persona("accounts", ACCOUNT_PERSONA), history: persona("linked", HISTORY_PERSONA) },
      input,
    }),
  );
  try {
    const r = runBun(["--conditions=source", "test", "--timeout", "120000", "./local/underwrite.run.ts"], {
      env: { ...process.env, LOCAL_TRIGGER_IN: inFile, LOCAL_TRIGGER_OUT: outFile },
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
      log(`callback ${JSON.parse(c.body).type} -> ${res.status}`);
    } catch (error) {
      log(`callback to ${c.url} failed: ${error.message}`);
    }
  }
}

/** One run at a time, in arrival order (CRE fires an HTTP trigger once per 30 s; the API spaces them too). */
let queue = Promise.resolve();

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/trigger")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "POST /trigger" }));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) req.destroy();
  });
  req.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw).input;
      if (!input || typeof input !== "object" || typeof input.user !== "string") throw new Error("no input.user");
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `body must be {"input": payload}: ${error.message}` }));
      return;
    }
    // Accepted now and run in order: the API's call to the trigger has a short timeout.
    res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
    queue = queue.then(async () => {
      log(`underwriting ${input.user}${input.linked?.wallet ? ` with history ${input.linked.wallet}` : ""} (fixture evidence: ${ACCOUNT_PERSONA} + ${HISTORY_PERSONA})`);
      try {
        const out = runOnce(input);
        const r = out.result;
        const score = r.onChainScore !== null && r.onChainScore !== undefined ? ` (score ${r.onChainScore})` : "";
        log(`-> ${r.status}${score}${r.reason ? `: ${r.reason}` : ""}${r.txHash ? ` tx ${r.txHash}` : ""}`);
        await deliver(out.callbacks);
      } catch (error) {
        log(`run failed: ${error.message}`);
      }
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${PORT}/trigger (chain ${RPC}, fixture personas ${ACCOUNT_PERSONA} + ${HISTORY_PERSONA})`);
  if (!CALLBACK_URL) log("POLARIS_CALLBACK_URL is not set: decisions reach the chain, but the API won't hear about them");
});
