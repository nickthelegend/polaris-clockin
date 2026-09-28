/**
 * The evidence and collections-loop scripts: reading a `cre workflow simulate`
 * run back from the CLI's output, refusing before anything is sent, and
 * keeping secrets out of what they write.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { encodeAbiParameters, keccak256, pad, toHex } from "viem";
import { fs, os } from "./helpers/host.ts";
// @ts-expect-error: plain ESM scripts, no type declarations
import { creEnv } from "../scripts/cre.mjs";
// @ts-expect-error: plain ESM scripts, no type declarations
import { loopPreflight, loopRecord } from "../scripts/collections-loop.mjs";
// @ts-expect-error: plain ESM scripts, no type declarations
import { preflight, REAUTHORIZED_TOPIC, reauthorizedLogIndex, simulateArgs, WORKFLOWS } from "../scripts/evidence.mjs";
// @ts-expect-error: plain ESM scripts, no type declarations
import { listenPreflight, takeRuns } from "../scripts/retry-listen.mjs";
import { REAUTHORIZED_TOPIC as WORKFLOW_REAUTHORIZED_TOPIC } from "../src/collections/retry.ts";
import {
  markdownTable,
  NOT_LOGGED_IN,
  outcomeOf,
  parseSimulation,
  readWhoami,
  REPORT_PROCESSED_TOPIC,
  redact,
  simulationEnv,
  verifyTx,
  // @ts-expect-error: plain ESM scripts, no type declarations
} from "../scripts/sim.mjs";

const TX = `0x${"ab".repeat(32)}`;
const ESC = "\u001b";
const result = (r: Record<string, unknown>) => JSON.stringify(JSON.stringify(r));

/** What the CLI prints (cre-cli v1.35.0 simulate.go / simulate_logger.go), colours and all. */
const cliOutput = (r: Record<string, unknown>, logs: string[]) =>
  [
    `${ESC}[32m✓${ESC}[0m Workflow compiled`,
    `${ESC}[34m2026-09-28T12:00:00Z${ESC}[0m ${ESC}[96m[SIMULATION]${ESC}[0m Simulator Initialized`,
    ...logs.map((l) => `${ESC}[34m2026-09-28T12:01:00Z${ESC}[0m ${ESC}[35m[USER LOG]${ESC}[0m ${l}`),
    "",
    `${ESC}[32m✓${ESC}[0m Workflow Simulation Result:`,
    result(r),
    "",
  ].join("\r\n");

describe("parseSimulation", () => {
  test("reads the handler's result and every transaction hash from the CLI's output", () => {
    const out = parseSimulation(
      cliOutput({ status: "written", source: "chain", tasks: [{ action: "collect", id: "3" }], executed: 1, skipped: 0, heldBack: [], txHash: TX }, [
        `wrote 1 tasks, gas limit 193810 (estimate 138530), tx ${TX}`,
        "collect #3 ok",
      ]),
    );
    expect(out.result).toMatchObject({ status: "written", txHash: TX });
    expect(out.txHashes).toEqual([TX]);
    expect(out.logs).toEqual([`wrote 1 tasks, gas limit 193810 (estimate 138530), tx ${TX}`, "collect #3 ok"]);
    expect(out.error).toBeNull();
    expect(outcomeOf(out, 0)).toBe("written; 1 task(s): collect #3; 1 executed, 0 skipped; candidates: chain");
  });

  test("a dry run's zero hash and a run that wrote nothing give no transaction", () => {
    expect(parseSimulation(cliOutput({ status: "dry-run", txHash: `0x${"0".repeat(64)}` }, [])).txHashes).toEqual([]);
    const idle = parseSimulation(cliOutput({ status: "idle", source: "chain", tasks: [], heldBack: [{ action: "collect", id: "2", nextAttemptAt: 1 }], txHash: null }, []));
    expect(idle.txHashes).toEqual([]);
    expect(outcomeOf(idle, 0)).toBe("idle; 1 held back by the ladder; candidates: chain");
    const thin = parseSimulation(cliOutput({ status: "thin", reason: "thin file: 3 days, 2 transactions", txHash: null }, []));
    expect(outcomeOf(thin, 0)).toBe("thin; thin file: 3 days, 2 transactions");
  });

  test("the guardian's result reads as its verdict, and a log-triggered run names what fired it (not as its own write)", () => {
    const guardian = parseSimulation(
      cliOutput(
        {
          status: "written",
          why: "verdict",
          transition: "paused",
          verdict: { creditPaused: true, reasons: 1, reasonNames: ["depeg"] },
          price: { kind: "chainlink", answer: "0.99982564" },
          round: "3",
          refusal: null,
          txHash: TX,
        },
        [`wrote the attestation, gas limit 150000 (estimate 121000), tx ${TX}`],
      ),
    );
    expect(outcomeOf(guardian, 0)).toBe("written (paused); paused: depeg; round 3; AUSD/USD 0.99982564 (chainlink)");
    const quiet = parseSimulation(
      cliOutput({ status: "unchanged", why: "unchanged", transition: "unchanged", verdict: { creditPaused: false, reasons: 0, reasonNames: [] }, price: { kind: "chainlink", answer: "0.9998" }, round: null, txHash: null }, []),
    );
    expect(outcomeOf(quiet, 0)).toBe("unchanged; healthy; nothing new to attest; AUSD/USD 0.9998 (chainlink)");
    expect(quiet.txHashes).toEqual([]);

    const reauth = `0x${"cd".repeat(32)}`;
    const retry = parseSimulation(
      cliOutput(
        {
          status: "written",
          trigger: { kind: "log", event: "Reauthorized", buyer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", txHash: reauth, logIndex: 1 },
          source: "event",
          tasks: [{ action: "collect", id: "3" }],
          executed: 1,
          skipped: 0,
          heldBack: [],
          txHash: TX,
        },
        [`Reauthorized: 0x90F79bf6EB2c4f870365E785982E1f101E93b906 re-signed for 150000000 (tx ${reauth}, block 42)`, `wrote 1 tasks, gas limit 168109 (estimate 120000), tx ${TX}`],
      ),
    );
    expect(retry.txHashes).toEqual([TX]);
    expect(outcomeOf(retry, 0)).toBe("written; log trigger: Reauthorized by 0x90F79bf6EB2c4f870365E785982E1f101E93b906; 1 task(s): collect #3; 1 executed, 0 skipped");
  });

  test("a failed run has no result, and says why", () => {
    const out = parseSimulation(`${ESC}[31m✗${ESC}[0m workflow execution returned an error: CollectionsReceiver reverted the report\n`);
    expect(out.result).toBeNull();
    expect(out.error).toContain("CollectionsReceiver reverted the report");
    expect(outcomeOf(out, 1)).toContain("failed: ");
  });
});

describe("secrets never reach a log", () => {
  const key = `0x${"1f".repeat(32)}`;
  const env = { CRE_ETH_PRIVATE_KEY: key, NANSEN_API_KEY: "nansen-secret-value", POLARIS_CALLBACK_SECRET: "cb-secret-123", SHORT: "x" };

  test("every secret value is redacted, a private key with or without its 0x", () => {
    const text = `key ${key} bare ${key.slice(2)} nansen nansen-secret-value cb cb-secret-123 plain words`;
    const out = redact(text, env);
    expect(out).not.toContain(key.slice(2));
    expect(out).not.toContain("nansen-secret-value");
    expect(out).not.toContain("cb-secret-123");
    expect(out).toContain("plain words");
  });

  test("the Zerion Basic credential is derived for the CLI, never printed, and never overrides one already set", () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "polaris-env-"));
    const file = join(dir, ".env");
    fs.writeFileSync(file, "ZERION_API_KEY=zk_test_123\n");
    expect(creEnv({ PATH: "x" }, file).ZERION_BASIC_AUTH).toBe(Buffer.from("zk_test_123:").toString("base64"));
    expect(creEnv({ PATH: "x", ZERION_BASIC_AUTH: "already" }, file).ZERION_BASIC_AUTH).toBe("already");
    expect(creEnv({ PATH: "x" }, join(dir, "missing.env")).ZERION_BASIC_AUTH).toBeUndefined();
    // The simulation environment layers the shell over workflows/.env.
    expect(simulationEnv({ ZERION_API_KEY: "from-shell" }, file).ZERION_BASIC_AUTH).toBe(Buffer.from("from-shell:").toString("base64"));
    expect(redact(`auth ${Buffer.from("zk_test_123:").toString("base64")}`, simulationEnv({}, file))).toBe("auth [redacted]");
  });
});

describe("refusing before anything is sent", () => {
  const whoamiOut = [
    "Initializing...",
    "",
    "! You are not logged in",
    "",
    "✗ Authentication required: not logged in and no CRE_API_KEY set",
  ].join("\n");

  test("cre whoami's own words when logged out", () => {
    expect(readWhoami({ code: 1, output: whoamiOut })).toEqual({ loggedIn: false, deployAccess: null });
    expect(readWhoami({ code: 0, output: "Organization: Polaris\nDeploy Access: Enabled\n" })).toEqual({ loggedIn: true, deployAccess: "Enabled" });
  });

  const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  const deployment = {
    chainId: 10143,
    contracts: Object.fromEntries(
      ["CollectionsReceiver", "PolarisLoanEngine", "PolarisPayments", "UnderwritingReceiver", "ScoreManager", "Stablecoin", "PolarisCheckout"].map((c, i) => [
        c,
        { address: address(i + 1) },
      ]),
    ),
  };
  const ok = {
    whoami: { loggedIn: true, deployAccess: null },
    deployment,
    deploymentFile: "deployments/monad-testnet.json",
    target: "staging-settings",
    workflows: ["collections", "underwriting"],
    env: { CRE_ETH_PRIVATE_KEY: `0x${"22".repeat(32)}` },
    configOf: () => null,
  };

  test("ready: nothing to refuse", () => {
    expect(preflight(ok)).toEqual([]);
  });

  test("not logged in, no deployment, a missing address, another chain, no transmitter key: each named", () => {
    expect(preflight({ ...ok, whoami: { loggedIn: false, deployAccess: null } })).toEqual([NOT_LOGGED_IN]);
    expect(preflight({ ...ok, deployment: null })[0]).toContain("No deployment record at deployments/monad-testnet.json");
    const noReceiver = { ...deployment, contracts: { ...deployment.contracts, UnderwritingReceiver: undefined } };
    expect(preflight({ ...ok, deployment: noReceiver })).toEqual(["The deployment has no UnderwritingReceiver address, which underwriting needs."]);
    expect(preflight({ ...ok, deployment: { ...deployment, chainId: 143 } })[0]).toContain("not Monad testnet (10143)");
    expect(preflight({ ...ok, env: {} })[0]).toContain("CRE_ETH_PRIVATE_KEY is not set");
    expect(preflight({ ...ok, target: "production-settings" })[0]).toContain("is not one this script broadcasts to");
  });

  test("the guardian needs GuardianReceiver, and collections (for its log trigger) PolarisCheckout, from the deployment", () => {
    expect(WORKFLOWS.guardian).toMatchObject({ dir: "./guardian", trigger: "cron", receiver: "GuardianReceiver" });
    expect(preflight({ ...ok, workflows: ["guardian"] })).toEqual(["The deployment has no GuardianReceiver address, which guardian needs."]);
    const full = { ...deployment, contracts: { ...deployment.contracts, GuardianReceiver: { address: address(9) }, PolarisCheckout: { address: address(10) } } };
    expect(preflight({ ...ok, deployment: full, workflows: ["collections", "underwriting", "guardian"] })).toEqual([]);
    expect(preflight({ ...ok, deployment: { ...full, contracts: { ...full.contracts, PolarisCheckout: undefined } } })).toEqual([
      "The deployment has no PolarisCheckout address, which collections needs.",
    ]);
  });

  test("--retry-tx: a transaction hash, and only with collections", () => {
    const full = { ...deployment, contracts: { ...deployment.contracts, PolarisCheckout: { address: address(10) } } };
    expect(preflight({ ...ok, deployment: full, retryTx: TX })).toEqual([]);
    expect(preflight({ ...ok, deployment: full, retryTx: "0x1234" })).toEqual(["--retry-tx must be a transaction hash (0x and 64 hex characters)."]);
    expect(preflight({ ...ok, deployment: full, workflows: ["underwriting"], retryTx: TX })).toEqual(["--retry-tx runs collections' log trigger: include collections."]);
  });

  test("the loop: logged in, the workflow configured, and a key when it broadcasts", () => {
    const config = { receiver: address(1), loanEngine: address(2), payments: address(3), schedule: "0 * * * * *" };
    const base = { whoami: { loggedIn: true }, target: "staging-settings", config, broadcast: true, env: { CRE_ETH_PRIVATE_KEY: "0x" + "22".repeat(32) } };
    expect(loopPreflight(base)).toEqual([]);
    expect(loopPreflight({ ...base, whoami: { loggedIn: false } })).toEqual([NOT_LOGGED_IN]);
    expect(loopPreflight({ ...base, config: { ...config, receiver: null } })[0]).toContain("has no receiver");
    expect(loopPreflight({ ...base, env: {} })[0]).toContain("--broadcast needs CRE_ETH_PRIVATE_KEY");
    expect(loopPreflight({ ...base, broadcast: false, env: {} })).toEqual([]);
    // guardian:loop needs only its receiver; an unknown workflow is refused.
    expect(loopPreflight({ ...base, workflow: "guardian", config: { receiver: address(9), schedule: "0 * * * * *" } })).toEqual([]);
    expect(loopPreflight({ ...base, workflow: "guardian", config: { receiver: null } })[0]).toBe(
      "guardian/config.staging.json has no receiver: deploy, then `configure staging`",
    );
    expect(loopPreflight({ ...base, workflow: "underwriting" })[0]).toContain('workflow "underwriting" is not one this loop runs');
  });

  test("the retry listener: the loop's checks, and a log trigger to listen with", () => {
    const config = { receiver: address(1), loanEngine: address(2), payments: address(3), retry: { checkout: address(10), confidence: "FINALIZED" } };
    const base = { whoami: { loggedIn: true }, target: "staging-settings", config, broadcast: false, env: {} };
    expect(listenPreflight(base)).toEqual([]);
    expect(listenPreflight({ ...base, config: { ...config, retry: null } })).toEqual([
      "collections/config.staging.json has retry: null, so there is no log trigger to listen with",
    ]);
    expect(listenPreflight({ ...base, config: { ...config, retry: { checkout: null, confidence: "FINALIZED" } } })[0]).toContain("has no retry.checkout");
  });

  test("a loop run's record: the outcome, what the ladder held back, the transaction", () => {
    const parsed = parseSimulation(cliOutput({ status: "written", source: "chain", tasks: [{ action: "collect", id: "3" }], executed: 1, skipped: 0, heldBack: [{ action: "charge", id: "1", nextAttemptAt: 5 }], txHash: TX }, []));
    expect(loopRecord({ run: 4, startedAt: "a", finishedAt: "b", target: "staging-settings", broadcast: true, code: 0, parsed })).toEqual({
      run: 4,
      startedAt: "a",
      finishedAt: "b",
      target: "staging-settings",
      broadcast: true,
      exitCode: 0,
      outcome: "written; 1 task(s): collect #3; 1 executed, 0 skipped; 1 held back by the ladder; candidates: chain",
      status: "written",
      source: "chain",
      tasks: [{ action: "collect", id: "3" }],
      heldBack: [{ action: "charge", id: "1", nextAttemptAt: 5 }],
      executed: 1,
      skipped: 0,
      txHash: TX,
      error: null,
    });
  });
});

describe("the log trigger's evidence run", () => {
  const checkout = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";

  test("finds Reauthorized in the reauthorize receipt, after the token's Approval, and passes its index to the CLI", () => {
    expect(REAUTHORIZED_TOPIC).toBe(WORKFLOW_REAUTHORIZED_TOPIC);
    const receipt = {
      logs: [
        { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", topics: [keccak256(toHex("Approval(address,address,uint256)"))] },
        { address: checkout.toLowerCase(), topics: [REAUTHORIZED_TOPIC, pad("0x90F79bf6EB2c4f870365E785982E1f101E93b906")] },
      ],
    };
    expect(reauthorizedLogIndex(receipt, checkout)).toBe(1);
    expect(reauthorizedLogIndex({ logs: receipt.logs.slice(0, 1) }, checkout)).toBe(-1);
    expect(reauthorizedLogIndex(receipt, "0x0000000000000000000000000000000000000bad")).toBe(-1);
    expect(reauthorizedLogIndex(null, checkout)).toBe(-1);
    expect(simulateArgs("collections", "staging-settings", { txHash: TX, eventIndex: 1 })).toEqual([
      "workflow",
      "simulate",
      "./collections",
      "-T",
      "staging-settings",
      "--non-interactive",
      "--trigger-index",
      "1",
      "--evm-tx-hash",
      TX,
      "--evm-event-index",
      "1",
      "--broadcast",
    ]);
    expect(simulateArgs("guardian", "staging-settings")).toEqual(["workflow", "simulate", "./guardian", "-T", "staging-settings", "--non-interactive", "--trigger-index", "0", "--broadcast"]);
    expect(simulateArgs("underwriting", "staging-settings").slice(-2)).toEqual(["--http-payload", "./underwriting/payload.json"]);
  });

  test("the listener cuts each finished run out of --listen's stream, and keeps the rest for later", () => {
    const run = (tx: string) =>
      cliOutput({ status: "written", trigger: { kind: "log", event: "Reauthorized", buyer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", txHash: `0x${"cd".repeat(32)}` }, tasks: [], executed: 1, skipped: 0, txHash: tx }, [
        `wrote 1 tasks, gas limit 168109 (estimate 120000), tx ${tx}`,
      ]);
    const tx2 = `0x${"ef".repeat(32)}`;
    const stream = `${run(TX)}${run(tx2)}${ESC}[34m2026-09-28T12:03:00Z${ESC}[0m Matching EVM log event found at block 43 (tx 0x…, index 1)\r\n`;
    const { runs, rest } = takeRuns(stream);
    expect(runs).toHaveLength(2);
    expect(runs.map((r: string) => parseSimulation(r).result?.txHash)).toEqual([TX, tx2]);
    expect(rest).toContain("Matching EVM log event found at block 43");
    // Half a run stays pending until its result arrives; a failed run ends at its error line.
    expect(takeRuns(run(TX).slice(0, -60)).runs).toHaveLength(0);
    const failed = takeRuns(`${ESC}[31m✗${ESC}[0m workflow execution returned an error: CollectionsReceiver reverted the report\nnext`);
    expect(failed.runs).toHaveLength(1);
    expect(failed.rest).toBe("next");
  });
});

describe("every hash is read back from the chain", () => {
  test("the forwarder's ReportProcessed topic is the event's", () => {
    expect(REPORT_PROCESSED_TOPIC).toBe(keccak256(toHex("ReportProcessed(address,bytes32,bytes2,bool)")));
  });

  test("a receipt becomes the row: landed, block, and the receiver's delivery result", async () => {
    const receiver = "0x00000000000000000000000000000000000c0113";
    const receipt = {
      status: "0x1",
      blockNumber: "0x2a",
      from: "0x0000000000000000000000000000000000000a11",
      to: "0xb9f79d863261869b234c481d1f9a7af84aead192",
      gasUsed: "0x24a51",
      logs: [
        { topics: [REPORT_PROCESSED_TOPIC, pad(receiver), `0x${"11".repeat(32)}`, pad("0x0001", { dir: "right" })], data: encodeAbiParameters([{ type: "bool" }], [true]) },
      ],
    };
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const { params } = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: params[0] === TX ? receipt : null }));
    };
    const tx = await verifyTx(TX, { fetchImpl });
    expect(tx).toEqual({ hash: TX, status: "success", blockNumber: 42, from: receipt.from, to: receipt.to, gasUsed: 0x24a51, delivered: [{ receiver, result: true }] });
    expect(await verifyTx(`0x${"cd".repeat(32)}`, { fetchImpl })).toBeNull();

    const table = markdownTable([{ at: "2026-09-28T12:01:00.000Z", workflow: "collections", target: "staging-settings", outcome: "written; 1 task(s): collect #3", tx }]);
    expect(table).toContain(`(https://testnet.monadscan.com/tx/${TX})`);
    expect(table).toContain("| 42 | result=true |");
    expect(markdownTable([{ at: "2026-09-28T12:01:00.000Z", workflow: "underwriting", target: "staging-settings", outcome: "thin", tx: null }])).toContain("| thin | none |");
  });
});
