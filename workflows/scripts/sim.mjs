/**
 * What `evidence` and `collections:loop` share: running the CRE CLI with its
 * output captured, reading a `cre workflow simulate` run back out of that
 * output, checking a transaction on Monad testnet, and keeping every secret
 * out of what is written down.
 *
 * The output format is the CLI's own (smartcontractkit/cre-cli v1.35.0,
 * cmd/workflow/simulate/simulate.go): user logs as `<time> [USER LOG] …`, then
 * `Workflow Simulation Result:` and the handler's return value marshalled as
 * JSON. Our handlers return a JSON string, so that line is a quoted string
 * holding the result object.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { creEnv, dotEnv, ensureUnderwritingBuilt, envWithBun, findCre, parseSecretsNames, ROOT, secretEnvFor } from "./cre.mjs";

export { ROOT };

/** Environment variables whose values must never reach a log, a file or the terminal. */
export const SECRET_ENV = [
  "CRE_ETH_PRIVATE_KEY",
  "CRE_API_KEY",
  "NANSEN_API_KEY",
  "ZERION_API_KEY",
  "ZERION_BASIC_AUTH",
  "ETHERSCAN_API_KEY",
  "POLARIS_CALLBACK_SECRET",
  "POLARIS_UNDERWRITE_ACCOUNT_KEY",
  "POLARIS_UNDERWRITE_WALLET_KEY",
  "DEPLOYER_PRIVATE_KEY",
];

/** Monad testnet: where every simulate --broadcast here writes. */
export const MONAD_TESTNET = { chainId: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadscan.com" };

/**
 * The shell's environment over workflows/.env, as the CLI sees it: Bun first
 * on PATH (the CLI compiles TypeScript workflows with it), the derived Zerion
 * credential, and every secret variable a workflow resolves defined, "" when
 * it has no value (scripts/cre.mjs creEnv).
 */
export function simulationEnv(env = process.env, file = join(ROOT, ".env"), root = ROOT) {
  return creEnv(envWithBun({ ...dotEnv(file), ...env }), file, root);
}

/**
 * The secret variables `cre workflow simulate` would abort on for these
 * workflows and target: each one `env` leaves unset. Empty when ready.
 */
export function missingSecretEnv(env, { target, workflows, root = ROOT }) {
  return secretEnvFor({ root, target, workflows }).filter((s) => env[s.envVar] === undefined);
}

/**
 * Underwriting's config for one run with every provider whose key is empty
 * left out (`secrets.<provider>: null`). Under Confidential HTTP the workflow
 * never reads a key, so it cannot tell an empty one from a real one: without
 * this, the enclave would template "" into each paid request and spend the
 * run's calls on 401s. `secretsNames` maps each secret id to its variables
 * (parseSecretsNames). Returns the config and the providers left out.
 */
export function withoutMissingKeys(config, secretsNames, env) {
  const secrets = { ...config.secrets };
  const leftOut = [];
  for (const [provider, id] of Object.entries(secrets)) {
    if (!id) continue;
    const vars = secretsNames[id] ?? [id];
    if (!vars.some((v) => typeof env[v] === "string" && env[v].trim() !== "")) {
      secrets[provider] = null;
      leftOut.push(provider);
    }
  }
  return { config: { ...config, secrets }, leftOut };
}

export { parseSecretsNames };

/** Every secret value this environment holds (and a private key without its 0x), longest first. */
export function secretValues(env) {
  const out = new Set();
  for (const name of SECRET_ENV) {
    const v = env[name];
    if (typeof v !== "string" || v.length < 8) continue;
    out.add(v);
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) out.add(v.slice(2));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** `text` with every secret value replaced by `[redacted]`. */
export function redact(text, env) {
  let out = text;
  for (const v of secretValues(env)) out = out.split(v).join("[redacted]");
  return out;
}

export function stripAnsi(s) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

const TX = /0x[0-9a-fA-F]{64}/g;
const ZERO_HASH = /^0x0{64}$/;

/**
 * One simulate run, read back from its output: the handler's result object
 * (or null), the error the CLI reported (or null), every user log line, and
 * every transaction-hash-shaped value in the result and the logs.
 */
export function parseSimulation(output) {
  const text = stripAnsi(output).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let result = null;
  const at = lines.findIndex((l) => l.includes("Workflow Simulation Result:"));
  if (at >= 0) {
    const body = [];
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i];
      if (body.length > 0 && l.trim() === "") break;
      if (l.trim() !== "") body.push(l);
    }
    try {
      let v = JSON.parse(body.join("\n"));
      if (typeof v === "string") v = JSON.parse(v);
      result = v && typeof v === "object" ? v : null;
    } catch {
      result = null;
    }
  }
  const logs = lines.filter((l) => l.includes("[USER LOG]")).map((l) => l.slice(l.indexOf("[USER LOG]") + 10).trim());
  const errorLine = lines.find((l) => /workflow execution (returned an error|failed)|^\s*(✗|Error:)/i.test(l));
  const hashes = new Set();
  if (result && typeof result.txHash === "string" && !ZERO_HASH.test(result.txHash)) hashes.add(result.txHash.toLowerCase());
  // A log-triggered run names the transaction that fired it; that one is not the run's own write.
  const trigger = typeof result?.trigger?.txHash === "string" ? result.trigger.txHash.toLowerCase() : null;
  for (const l of logs) for (const m of l.match(TX) ?? []) if (!ZERO_HASH.test(m) && m.toLowerCase() !== trigger) hashes.add(m.toLowerCase());
  return { result, error: errorLine ? errorLine.trim() : null, logs, txHashes: [...hashes] };
}

/**
 * Run the CRE CLI from the project root with its output captured (and, with
 * `echo`, shown as it comes). Resolves with the exit code and the output;
 * `timeoutMs` kills a run that hangs.
 */
export function runCreCaptured(args, { env = simulationEnv(), echo = true, timeoutMs = 5 * 60_000 } = {}) {
  if (args[0] === "workflow" && ["build", "simulate", "deploy", "hash"].includes(args[1])) ensureUnderwritingBuilt();
  return new Promise((resolve) => {
    const child = spawn(findCre(), args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk) => {
      const s = chunk.toString("utf8");
      output += s;
      if (echo) process.stdout.write(redact(s, env));
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      output += `\n[timed out after ${Math.round(timeoutMs / 1000)} s]\n`;
      child.kill();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${e.message}\n` });
    });
  });
}

/** `cre whoami`: logged in or not, and the deploy-access line if it prints one. Never the account's email. */
export function readWhoami({ code, output }) {
  const text = stripAnsi(output);
  const loggedIn = code === 0 && !/not logged in|authentication required/i.test(text);
  const access = /deploy access:\s*([^\n]+)/i.exec(text);
  return { loggedIn, deployAccess: access ? access[1].trim() : null };
}

export const NOT_LOGGED_IN =
  "Not logged in to CRE: `cre workflow simulate` needs a CRE account. Run `pnpm --filter @polaris/cre-workflows cre login` " +
  "in a terminal (a browser login), or set CRE_API_KEY, then run this again.";

/** One JSON-RPC call (read-only methods only are used here). */
export async function rpc(url, method, params, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/** keccak256("ReportProcessed(address,bytes32,bytes2,bool)"): the forwarder's delivery event. */
export const REPORT_PROCESSED_TOPIC = "0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5";

/**
 * A transaction on Monad testnet, from its receipt: whether it landed, where,
 * and what each forwarder `ReportProcessed` said about the receiver (a
 * simulated delivery "succeeds" even when the receiver reverted, so this is
 * the result that counts). `null` when the hash is not a transaction there.
 */
export async function verifyTx(hash, { url = MONAD_TESTNET.rpc, fetchImpl = fetch } = {}) {
  const r = await rpc(url, "eth_getTransactionReceipt", [hash], fetchImpl);
  if (!r) return null;
  const delivered = (r.logs ?? [])
    .filter((l) => (l.topics?.[0] ?? "").toLowerCase() === REPORT_PROCESSED_TOPIC)
    .map((l) => ({ receiver: `0x${l.topics[1].slice(26)}`, result: BigInt(l.data.slice(0, 66)) === 1n }));
  return {
    hash,
    status: r.status === "0x1" ? "success" : "reverted",
    blockNumber: Number.parseInt(r.blockNumber, 16),
    from: r.from,
    to: r.to,
    gasUsed: Number.parseInt(r.gasUsed, 16),
    delivered,
  };
}

/** The deployment record (packages/contracts/deployments/monad-testnet.json by default), or null. */
export function readDeployment(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** A markdown table of evidence rows. */
export function markdownTable(rows, explorer = MONAD_TESTNET.explorer) {
  const head = "| When (UTC) | Workflow | Target | Outcome | Transaction | Block | Delivered |\n|---|---|---|---|---|---:|---|";
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const body = rows.map((r) => {
    const tx = r.tx ? `[${r.tx.hash.slice(0, 10)}…${r.tx.hash.slice(-6)}](${explorer}/tx/${r.tx.hash})` : "none";
    const delivered = r.tx ? (r.tx.delivered.length === 0 ? "no ReportProcessed" : r.tx.delivered.map((d) => (d.result ? "result=true" : "result=false")).join(", ")) : "";
    return `| ${cell(r.at.slice(0, 19).replace("T", " "))} | ${cell(r.workflow)} | ${cell(r.target)} | ${cell(r.outcome)} | ${tx} | ${r.tx ? r.tx.blockNumber : ""} | ${cell(delivered)} |`;
  });
  return [head, ...body].join("\n");
}

/**
 * One line for a run's outcome: `written; 2 task(s): …`, `thin; …`,
 * `written (paused); paused: depeg; round 3; AUSD/USD 0.99 (chainlink)`,
 * `failed: …`.
 */
export function outcomeOf(parsed, code) {
  const r = parsed.result;
  if (!r) return code === 0 ? "no result printed" : `failed: ${(parsed.error ?? "see the log").slice(0, 160)}`;
  if (r.verdict && typeof r.verdict === "object") return guardianOutcome(r);
  const parts = [String(r.status ?? "unknown")];
  const byLog = r.trigger?.kind === "log";
  if (byLog) parts.push(`log trigger: ${r.trigger.event} by ${r.trigger.buyer}`);
  if (Array.isArray(r.tasks) && r.tasks.length > 0) parts.push(`${r.tasks.length} task(s): ${r.tasks.map((t) => `${t.action} #${t.id}`).join(", ")}`);
  if (typeof r.executed === "number" && typeof r.skipped === "number" && r.status === "written") parts.push(`${r.executed} executed, ${r.skipped} skipped`);
  if (Array.isArray(r.heldBack) && r.heldBack.length > 0) parts.push(`${r.heldBack.length} held back by the ladder`);
  if (typeof r.onChainScore === "number") parts.push(`score ${r.onChainScore}`);
  if (r.reason) parts.push(String(r.reason).slice(0, 120));
  if (r.source && !byLog) parts.push(`candidates: ${r.source}`);
  return parts.join("; ");
}

/** polaris-guardian's result as one line. */
function guardianOutcome(r) {
  const moved = r.transition && r.transition !== "unchanged" ? ` (${r.transition})` : "";
  const parts = [`${r.status}${r.status === "written" ? moved : ""}`];
  parts.push(r.verdict.creditPaused ? `paused: ${(r.verdict.reasonNames ?? []).join(", ")}` : "healthy");
  if (r.round) parts.push(`round ${r.round}`);
  if (r.refusal) parts.push(`refused: ${r.refusal}`);
  if (r.status === "unchanged" && r.why) parts.push(r.why === "not-newer" ? "no newer block" : "nothing new to attest");
  if (r.price) parts.push(`AUSD/USD ${r.price.answer} (${r.price.kind})`);
  return parts.join("; ");
}
