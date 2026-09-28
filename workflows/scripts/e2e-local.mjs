#!/usr/bin/env node
/**
 * One command for the on-chain round trip:
 *
 *   pnpm --filter @polaris/cre-workflows e2e:local
 *
 * Starts the local Monad stand-in (scripts/local-chain.mjs: Hardhat on
 * 127.0.0.1:8620, chain 10143, every contract deployed, the mock forwarder at
 * Chainlink's simulation-forwarder address), runs e2e/*.e2e.test.ts against it
 * with Bun, and stops the node. The node's log is printed on failure.
 */

import { readFileSync } from "node:fs";
import { runBun } from "./bun.mjs";
import { RPC_URL, setUpLocalChain, startLocalChain } from "./local-chain.mjs";

async function main() {
  const { node, logFile } = await startLocalChain();
  let ok = false;
  try {
    console.log(`Local chain on ${RPC_URL} (log: ${logFile})`);
    const { deploymentFile } = await setUpLocalChain();
    const r = runBun(["--conditions=source", "test", "--timeout", "120000", "./e2e"], {
      env: { ...process.env, POLARIS_CRE_E2E_RPC: RPC_URL, POLARIS_CRE_E2E_DEPLOYMENT: deploymentFile },
    });
    if (r.error) throw r.error;
    ok = r.status === 0;
    if (!ok) process.exitCode = r.status ?? 1;
  } finally {
    node.kill();
    if (!ok) {
      try {
        console.error(`\nLast lines of the node log (${logFile}):\n${readFileSync(logFile, "utf8").split("\n").slice(-30).join("\n")}`);
      } catch {
        // no log
      }
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
