#!/usr/bin/env node
/**
 * A cron workflow every minute, on your machine, for the demo recording: the
 * CRE CLI simulating it over and over, each run fired by the workflow's own
 * cron at its next tick (staging: second 0 of every minute).
 *
 *   pnpm --filter @polaris/cre-workflows collections:loop                # dry runs: nothing is sent
 *   pnpm --filter @polaris/cre-workflows collections:loop --broadcast    # real transactions on Monad testnet
 *   pnpm --filter @polaris/cre-workflows guardian:loop --broadcast       # polaris-guardian the same way
 *   CRE_LOOP_BROADCAST=1 pnpm --filter @polaris/cre-workflows collections:loop
 *
 * Options: --workflow <collections|guardian> (default collections; the
 * `guardian:loop` script passes guardian), --target
 * <staging-settings|local-settings> (default staging), --runs <n> to stop
 * after n runs, --no-build to reuse <workflow>/binary.wasm. Run both loops in
 * two terminals for the demo, and `retry:listen` in a third for the
 * collections workflow's log trigger (scripts/retry-listen.mjs).
 *
 * Simulation never schedules a cron by itself: each `cre workflow simulate`
 * fires once, at the schedule's next tick (the simulator's cron trigger waits
 * for it and stamps that exact time), so this loop starts the next run as
 * soon as one ends. It builds the WASM once and passes `--wasm`, so a run
 * spends its minute waiting for the tick, not compiling. The guardian writes
 * only when it has something new (a changed verdict, its heartbeat, a large
 * move), so most of its runs send nothing.
 *
 * Each run is appended to workflows/evidence/loop/<UTC date>.log (collections)
 * or <UTC date>-guardian.log (the CLI's output, secrets redacted) and one JSON
 * line to the matching .jsonl: when, the outcome, the tasks or the verdict,
 * what the dunning ladder held back, and the transaction. Stop it with Ctrl+C.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_LOGGED_IN, outcomeOf, parseSimulation, readWhoami, redact, ROOT, runCreCaptured, simulationEnv } from "./sim.mjs";

export const LOOP_DIR = join(ROOT, "evidence", "loop");
const CONFIG_FOR = { "staging-settings": "config.staging.json", "local-settings": "config.local.json" };

/** The cron workflows this loop runs, the config keys each needs, and where its runs are logged. */
export const LOOPED = {
  collections: { required: ["receiver", "loanEngine", "payments"], suffix: "" },
  guardian: { required: ["receiver"], suffix: "-guardian" },
};

const has = (flag) => process.argv.includes(`--${flag}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The JSON line one run leaves in its .jsonl. */
export function loopRecord({ run, startedAt, finishedAt, target, broadcast, code, parsed }) {
  const r = parsed.result ?? {};
  const record = {
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
  // polaris-guardian: the verdict instead of tasks.
  if (r.verdict) Object.assign(record, { verdict: r.verdict, transition: r.transition ?? null, round: r.round ?? null, price: r.price?.answer ?? null });
  return record;
}

/** Why the loop cannot start, or [] when it can. */
export function loopPreflight({ whoami, target, config, broadcast, env, workflow = "collections" }) {
  const problems = [];
  const w = LOOPED[workflow];
  if (!whoami.loggedIn) problems.push(NOT_LOGGED_IN);
  if (!w) problems.push(`workflow "${workflow}" is not one this loop runs: use ${Object.keys(LOOPED).join(" or ")}`);
  else if (!CONFIG_FOR[target]) problems.push(`target "${target}" is not one this loop runs: use staging-settings or local-settings`);
  else if (!config) problems.push(`no ${workflow}/${CONFIG_FOR[target]}: run \`pnpm --filter @polaris/cre-workflows configure ${target.split("-")[0]}\` after the deployment`);
  else {
    const missing = w.required.filter((k) => !config[k]);
    if (missing.length > 0) problems.push(`${workflow}/${CONFIG_FOR[target]} has no ${missing.join(", ")}: deploy, then \`configure ${target.split("-")[0]}\``);
  }
  if (broadcast && !env.CRE_ETH_PRIVATE_KEY) problems.push("--broadcast needs CRE_ETH_PRIVATE_KEY (workflows/.env or the shell): the dedicated key the simulator sends with.");
  return problems;
}

async function main() {
  const workflow = arg("workflow") ?? "collections";
  const target = arg("target") ?? "staging-settings";
  const broadcast = has("broadcast") || process.env.CRE_LOOP_BROADCAST === "1";
  const maxRuns = arg("runs") ? Number(arg("runs")) : Number.POSITIVE_INFINITY;
  const env = simulationEnv();

  const whoami = readWhoami(await runCreCaptured(["whoami"], { env, echo: false, timeoutMs: 60_000 }));
  const configFile = CONFIG_FOR[target] && LOOPED[workflow] ? join(ROOT, workflow, CONFIG_FOR[target]) : null;
  const config = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : null;
  const problems = loopPreflight({ whoami, target, config, broadcast, env, workflow });
  if (problems.length > 0) {
    console.error(`Refusing to start the ${workflow} loop:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 2;
    return;
  }

  const wasm = `./${workflow}/binary.wasm`;
  if (!has("no-build") || !existsSync(join(ROOT, wasm))) {
    console.log(`Building ${workflow} to WASM once ...`);
    const built = await runCreCaptured(["workflow", "build", `./${workflow}`], { env });
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
  console.log(`${workflow}:loop on ${target}, ${broadcast ? "BROADCASTING to the chain" : "dry runs (add --broadcast to send)"}, cron ${config.schedule}`);

  const suffix = LOOPED[workflow].suffix;
  for (let run = 1; run <= maxRuns && !stop; run++) {
    const args = ["workflow", "simulate", `./${workflow}`, "-T", target, "--non-interactive", "--trigger-index", "0", "--wasm", wasm];
    if (broadcast) args.push("--broadcast");
    const startedAt = new Date().toISOString();
    const { code, output } = await runCreCaptured(args, { env, echo: false, timeoutMs: 4 * 60_000 });
    const finishedAt = new Date().toISOString();
    const parsed = parseSimulation(output);
    const record = loopRecord({ run, startedAt, finishedAt, target, broadcast, code, parsed });
    const day = startedAt.slice(0, 10);
    appendFileSync(join(LOOP_DIR, `${day}${suffix}.log`), `\n=== run ${run} ${startedAt} ${target}${broadcast ? " --broadcast" : ""} exit ${code} ===\n${redact(output, env)}`);
    appendFileSync(join(LOOP_DIR, `${day}${suffix}.jsonl`), `${JSON.stringify(record)}\n`);
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
