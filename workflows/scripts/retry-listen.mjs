#!/usr/bin/env node
/**
 * The instant retry, live: the CRE CLI listening for PolarisCheckout's
 * `Reauthorized` logs and running polaris-collections' trigger 1 (the EVM log
 * trigger) for each one, the way a deployed DON would.
 *
 *   pnpm --filter @polaris/cre-workflows retry:listen                # dry runs: nothing is sent
 *   pnpm --filter @polaris/cre-workflows retry:listen --broadcast    # collect on Monad testnet
 *
 * Options: --target <staging-settings|local-settings> (default staging),
 * --no-build to reuse collections/binary.wasm.
 *
 * It runs `cre workflow simulate ./collections -T <target> --non-interactive
 * --trigger-index 1 --listen --wasm ./collections/binary.wasm [--broadcast]`:
 * CLI v1.35.0's `--listen` watches the chain for logs matching the trigger's
 * filter (PolarisCheckout's address, Reauthorized's topic0) and runs the
 * simulator on each match. (`--listen` cannot be combined with
 * `--evm-tx-hash`; for one past transaction use `simulate:retry`.)
 *
 * The CLI's output (secrets redacted) goes to
 * workflows/evidence/loop/<UTC date>-retry.log, and each run it completes
 * becomes a JSON line in <UTC date>-retry.jsonl (the same record as
 * collections:loop, read by the same parser as a single run). Ctrl+C stops it.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOOP_DIR, loopPreflight, loopRecord } from "./collections-loop.mjs";
import { findCre } from "./cre.mjs";
import { parseSimulation, readWhoami, redact, ROOT, runCreCaptured, simulationEnv, stripAnsi } from "./sim.mjs";

const CONFIG_FOR = { "staging-settings": "config.staging.json", "local-settings": "config.local.json" };
const ERROR_LINE = /workflow execution (returned an error|failed)[^\n]*\n/i;
const RESULT = "Workflow Simulation Result:";

const has = (flag) => process.argv.includes(`--${flag}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/**
 * Cut every run the listener has finished out of its output so far: a run
 * ends with its result (the line after "Workflow Simulation Result:") or with
 * the CLI's error line. Returns the finished runs' text and what is left.
 */
export function takeRuns(output) {
  let text = stripAnsi(output).replace(/\r\n/g, "\n");
  const runs = [];
  for (;;) {
    const at = text.indexOf(RESULT);
    const err = ERROR_LINE.exec(text);
    if (err && (at < 0 || err.index < at)) {
      const end = err.index + err[0].length;
      runs.push(text.slice(0, end));
      text = text.slice(end);
      continue;
    }
    if (at < 0) break;
    let i = text.indexOf("\n", at);
    if (i < 0) break;
    while (text[i + 1] === "\n") i++;
    const end = text.indexOf("\n", i + 1);
    if (end < 0) break;
    runs.push(text.slice(0, end + 1));
    text = text.slice(end + 1);
  }
  return { runs, rest: text };
}

/** Why the listener cannot start, or [] when it can: the loop's checks, plus the retry's checkout. */
export function listenPreflight({ whoami, target, config, broadcast, env }) {
  const problems = loopPreflight({ whoami, target, config, broadcast, env, workflow: "collections" });
  if (config && !config.retry) problems.push(`collections/${CONFIG_FOR[target] ?? "config"} has retry: null, so there is no log trigger to listen with`);
  else if (config && !config.retry.checkout) problems.push(`collections/${CONFIG_FOR[target] ?? "config"} has no retry.checkout: deploy, then \`configure ${target.split("-")[0]}\``);
  return problems;
}

async function main() {
  const target = arg("target") ?? "staging-settings";
  const broadcast = has("broadcast");
  const env = simulationEnv();
  const whoami = readWhoami(await runCreCaptured(["whoami"], { env, echo: false, timeoutMs: 60_000 }));
  const configFile = CONFIG_FOR[target] ? join(ROOT, "collections", CONFIG_FOR[target]) : null;
  const config = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : null;
  const problems = listenPreflight({ whoami, target, config, broadcast, env });
  if (problems.length > 0) {
    console.error("Refusing to start the retry listener:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 2;
    return;
  }

  const wasm = "./collections/binary.wasm";
  if (!has("no-build") || !existsSync(join(ROOT, wasm))) {
    console.log("Building collections to WASM once ...");
    const built = await runCreCaptured(["workflow", "build", "./collections"], { env });
    if (built.code !== 0) {
      console.error("cre workflow build failed; see above.");
      process.exitCode = 1;
      return;
    }
  }

  mkdirSync(LOOP_DIR, { recursive: true });
  const args = ["workflow", "simulate", "./collections", "-T", target, "--non-interactive", "--trigger-index", "1", "--listen", "--wasm", wasm];
  if (broadcast) args.push("--broadcast");
  console.log(`retry:listen on ${target}: Reauthorized from PolarisCheckout ${config.retry.checkout}, ${broadcast ? "BROADCASTING" : "dry runs (add --broadcast to send)"}`);
  const child = spawn(findCre(), args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  process.on("SIGINT", () => child.kill());

  let pending = "";
  let run = 0;
  let startedAt = new Date().toISOString();
  const take = (chunk) => {
    const s = chunk.toString("utf8");
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(LOOP_DIR, `${day}-retry.log`), redact(s, env));
    pending += s;
    const { runs, rest } = takeRuns(pending);
    pending = rest;
    for (const text of runs) {
      run++;
      const finishedAt = new Date().toISOString();
      const parsed = parseSimulation(text);
      const code = parsed.result ? 0 : 1;
      const record = loopRecord({ run, startedAt, finishedAt, target, broadcast, code, parsed });
      appendFileSync(join(LOOP_DIR, `${day}-retry.jsonl`), `${JSON.stringify(record)}\n`);
      console.log(`[${finishedAt.slice(11, 19)}] retry ${run}: ${record.outcome}${record.txHash ? ` tx ${record.txHash}` : ""}`);
      startedAt = finishedAt;
    }
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const code = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? 0)));
  console.log(`The listener stopped (exit ${code}). Logged to ${LOOP_DIR}`);
}

if (process.argv[1] && /retry-listen\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
