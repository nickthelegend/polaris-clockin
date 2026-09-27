#!/usr/bin/env node
/**
 * `polaris-collections` every minute, on your machine, for the demo recording:
 * the CRE CLI simulating the workflow over and over, each run fired by the
 * workflow's own cron at its next tick (staging: second 0 of every minute).
 *
 *   pnpm --filter @polaris/cre-workflows collections:loop                # dry runs: nothing is sent
 *   pnpm --filter @polaris/cre-workflows collections:loop --broadcast    # real transactions on Monad testnet
 *   CRE_LOOP_BROADCAST=1 pnpm --filter @polaris/cre-workflows collections:loop
 *
 * Options: --target <staging-settings|local-settings> (default staging),
 * --runs <n> to stop after n runs, --no-build to reuse collections/binary.wasm.
 *
 * Simulation never schedules a cron by itself: each `cre workflow simulate`
 * fires once, at the schedule's next tick (the simulator's cron trigger waits
 * for it and stamps that exact time), so this loop starts the next run as
 * soon as one ends. It builds the WASM once and passes `--wasm`, so a run
 * spends its minute waiting for the tick, not compiling.
 *
 * Each run is appended to workflows/evidence/loop/<UTC date>.log (the CLI's
 * output, secrets redacted) and one JSON line to <UTC date>.jsonl: when, the
 * outcome, the tasks, what the dunning ladder held back, and the transaction.
 * Stop it with Ctrl+C.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_LOGGED_IN, outcomeOf, parseSimulation, readWhoami, redact, ROOT, runCreCaptured, simulationEnv } from "./sim.mjs";

export const LOOP_DIR = join(ROOT, "evidence", "loop");
const CONFIG_FOR = { "staging-settings": "config.staging.json", "local-settings": "config.local.json" };

const has = (flag) => process.argv.includes(`--${flag}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The JSON line one run leaves in <date>.jsonl. */
export function loopRecord({ run, startedAt, finishedAt, target, broadcast, code, parsed }) {
  const r = parsed.result ?? {};
  return {
    run,
    startedAt,
    finishedAt,
    target,
    broadcast,
    exitCode: code,
    outcome: outcomeOf(parsed, code),
    status: r.status ?? null,
    source: r.source ?? null,
    tasks: r.tasks ?? [],
    heldBack: r.heldBack ?? [],
    executed: r.executed ?? null,
    skipped: r.skipped ?? null,
    txHash: parsed.txHashes[0] ?? null,
    error: parsed.result ? null : parsed.error,
  };
}

/** Why the loop cannot start, or [] when it can. */
export function loopPreflight({ whoami, target, config, broadcast, env }) {
  const problems = [];
  if (!whoami.loggedIn) problems.push(NOT_LOGGED_IN);
  if (!CONFIG_FOR[target]) problems.push(`target "${target}" is not one this loop runs: use staging-settings or local-settings`);
  else if (!config) problems.push(`no collections/${CONFIG_FOR[target]}: run \`pnpm --filter @polaris/cre-workflows configure ${target.split("-")[0]}\` after the deployment`);
  else {
    const missing = ["receiver", "loanEngine", "payments"].filter((k) => !config[k]);
    if (missing.length > 0) problems.push(`collections/${CONFIG_FOR[target]} has no ${missing.join(", ")}: deploy, then \`configure ${target.split("-")[0]}\``);
  }
  if (broadcast && !env.CRE_ETH_PRIVATE_KEY) problems.push("--broadcast needs CRE_ETH_PRIVATE_KEY (workflows/.env or the shell): the dedicated key the simulator sends with.");
  return problems;
}

async function main() {
  const target = arg("target") ?? "staging-settings";
  const broadcast = has("broadcast") || process.env.CRE_LOOP_BROADCAST === "1";
  const maxRuns = arg("runs") ? Number(arg("runs")) : Number.POSITIVE_INFINITY;
  const env = simulationEnv();

  const whoami = readWhoami(await runCreCaptured(["whoami"], { env, echo: false, timeoutMs: 60_000 }));
  const configFile = CONFIG_FOR[target] ? join(ROOT, "collections", CONFIG_FOR[target]) : null;
  const config = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : null;
  const problems = loopPreflight({ whoami, target, config, broadcast, env });
  if (problems.length > 0) {
    console.error("Refusing to start the collections loop:\n");
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
  let stop = false;
  process.on("SIGINT", () => {
    if (stop) process.exit(130);
    stop = true;
    console.log("\nStopping after this run (Ctrl+C again to quit now).");
  });
  console.log(`collections:loop on ${target}, ${broadcast ? "BROADCASTING to the chain" : "dry runs (add --broadcast to send)"}, cron ${config.schedule}`);

  for (let run = 1; run <= maxRuns && !stop; run++) {
    const args = ["workflow", "simulate", "./collections", "-T", target, "--non-interactive", "--trigger-index", "0", "--wasm", wasm];
    if (broadcast) args.push("--broadcast");
    const startedAt = new Date().toISOString();
    const { code, output } = await runCreCaptured(args, { env, echo: false, timeoutMs: 4 * 60_000 });
    const finishedAt = new Date().toISOString();
    const parsed = parseSimulation(output);
    const record = loopRecord({ run, startedAt, finishedAt, target, broadcast, code, parsed });
    const day = startedAt.slice(0, 10);
    appendFileSync(join(LOOP_DIR, `${day}.log`), `\n=== run ${run} ${startedAt} ${target}${broadcast ? " --broadcast" : ""} exit ${code} ===\n${redact(output, env)}`);
    appendFileSync(join(LOOP_DIR, `${day}.jsonl`), `${JSON.stringify(record)}\n`);
    console.log(`[${finishedAt.slice(11, 19)}] run ${run}: ${record.outcome}${record.txHash ? ` tx ${record.txHash}` : ""}`);
    // A run that failed before waiting for its tick would otherwise spin.
    if (code !== 0) await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(`Logged to ${LOOP_DIR}`);
}

if (process.argv[1] && /collections-loop\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}
