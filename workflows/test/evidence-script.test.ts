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
import { preflight, WORKFLOWS } from "../scripts/evidence.mjs";
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
      ["CollectionsReceiver", "PolarisLoanEngine", "PolarisPayments", "UnderwritingReceiver", "ScoreManager", "Stablecoin"].map((c, i) => [c, { address: address(i + 1) }]),
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

  test("a third workflow must come with its addresses in its own config", () => {
    expect(WORKFLOWS.guardian.trigger).toBe("cron");
    const problems = preflight({ ...ok, workflows: ["guardian"], configOf: () => ({ receiver: null, schedule: "0 */5 * * * *", callback: null }) });
    expect(problems).toEqual(["guardian: its config for staging-settings has no receiver (fill it after the deployment)."]);
  });

  test("the loop: logged in, collections configured, and a key when it broadcasts", () => {
    const config = { receiver: address(1), loanEngine: address(2), payments: address(3), schedule: "0 * * * * *" };
    const base = { whoami: { loggedIn: true }, target: "staging-settings", config, broadcast: true, env: { CRE_ETH_PRIVATE_KEY: "0x" + "22".repeat(32) } };
    expect(loopPreflight(base)).toEqual([]);
    expect(loopPreflight({ ...base, whoami: { loggedIn: false } })).toEqual([NOT_LOGGED_IN]);
    expect(loopPreflight({ ...base, config: { ...config, receiver: null } })[0]).toContain("has no receiver");
    expect(loopPreflight({ ...base, env: {} })[0]).toContain("--broadcast needs CRE_ETH_PRIVATE_KEY");
    expect(loopPreflight({ ...base, broadcast: false, env: {} })).toEqual([]);
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
