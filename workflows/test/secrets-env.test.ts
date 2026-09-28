/**
 * What `cre workflow simulate` needs from the environment before a run
 * starts. CLI v1.35.0 (cmd/workflow/simulate/secrets.go) resolves every name
 * in the secrets file a workflow.yaml target points at with os.LookupEnv, and
 * aborts the whole run ("environment variable X for secret value not found")
 * on one that is not set at all, whether or not the workflow reads it. So:
 *
 *   - the guardian, which reads no secret, points at none;
 *   - collections points at its own file, which names only its callback key;
 *   - every environment the scripts start the CLI with defines each name the
 *     workflows resolve, "" when there is no value;
 *   - a value in workflows/.env is never shadowed by that "".
 *
 * And for the evidence run, which is the bounty's proof: underwriting under
 * Confidential HTTP leaves out every provider without a key (else the
 * enclave would template "" into each paid request), and a run callback can
 * be pointed at a local API for that run only.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fs, os } from "./helpers/host.ts";
// @ts-expect-error: plain ESM scripts, no type declarations
import { allSecretEnvNames, CRE_TARGETS, parseSecretsNames, secretEnvFor, secretsPathOf, WORKFLOW_DIRS } from "../scripts/cre.mjs";
// @ts-expect-error: plain ESM scripts, no type declarations
import { missingSecretEnv, simulationEnv, withoutMissingKeys } from "../scripts/sim.mjs";
// @ts-expect-error: plain ESM scripts, no type declarations
import { cliConfigArg, preflight, runConfig, simulateArgs } from "../scripts/evidence.mjs";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => fs.readFileSync(join(ROOT, p), "utf8");
const KEY = `0x${"22".repeat(32)}`;

/** An env file that does not exist: only the shell's environment. */
const NO_FILE = join(fs.mkdtempSync(join(os.tmpdir(), "polaris-secrets-")), "missing.env");

const PROVIDER_NAMES = ["ETHERSCAN_API_KEY", "NANSEN_API_KEY", "POLARIS_CALLBACK_SECRET", "ZERION_API_KEY", "ZERION_BASIC_AUTH"];

describe("the secrets each workflow.yaml makes the CLI resolve", () => {
  test("every target: the guardian none, collections only its callback key, underwriting its providers and callback", () => {
    for (const target of CRE_TARGETS) {
      const names = (workflow: string) =>
        secretEnvFor({ root: ROOT, target, workflows: [workflow] })
          .map((s: { envVar: string }) => s.envVar)
          .sort();
      expect(names("guardian")).toEqual([]);
      expect(names("collections")).toEqual(["POLARIS_CALLBACK_SECRET"]);
      expect(names("underwriting")).toEqual(PROVIDER_NAMES);
    }
    expect(allSecretEnvNames(ROOT)).toEqual(PROVIDER_NAMES);
  });

  test("the reader: an empty secrets-path is none, a missing target is an error, comments are not values", () => {
    const yaml = [
      "# a comment: secrets-path: ./nope.yaml",
      "local-settings:",
      "  workflow-artifacts:",
      '    secrets-path: ""',
      "staging-settings:",
      "  workflow-artifacts:",
      '    secrets-path: "../secrets.yaml" # the shared file',
    ].join("\n");
    expect(secretsPathOf(yaml, "local-settings")).toBeNull();
    expect(secretsPathOf(yaml, "staging-settings")).toBe("../secrets.yaml");
    expect(() => secretsPathOf(yaml, "production-settings")).toThrow("no production-settings block");
    expect(parseSecretsNames(read("secrets.yaml"))).toEqual({
      NANSEN_API_KEY: ["NANSEN_API_KEY"],
      ZERION_API_KEY: ["ZERION_API_KEY"],
      ZERION_BASIC_AUTH: ["ZERION_BASIC_AUTH"],
      ETHERSCAN_API_KEY: ["ETHERSCAN_API_KEY"],
      POLARIS_CALLBACK_SECRET: ["POLARIS_CALLBACK_SECRET"],
    });
  });
});

describe("the environment the scripts start the CLI with", () => {
  test("defines every name each workflow.yaml resolves, with only the transmitter key given", () => {
    const env = simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY }, NO_FILE);
    for (const target of CRE_TARGETS) {
      for (const workflow of WORKFLOW_DIRS) {
        for (const s of secretEnvFor({ root: ROOT, target, workflows: [workflow] })) {
          expect({ workflow, target, name: s.envVar, defined: env[s.envVar] !== undefined }).toEqual({ workflow, target, name: s.envVar, defined: true });
        }
      }
      expect(missingSecretEnv(env, { target, workflows: WORKFLOW_DIRS, root: ROOT })).toEqual([]);
    }
    // Defined, and empty: a key that is not configured, never an invented one.
    for (const name of PROVIDER_NAMES) expect(env[name]).toBe("");
  });

  test("a value in workflows/.env or the shell is kept, never shadowed by the empty default", () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "polaris-secrets-"));
    const file = join(dir, ".env");
    fs.writeFileSync(file, "ETHERSCAN_API_KEY=from-file\nCRE_ETH_PRIVATE_KEY=abc\n");
    const env = simulationEnv({ NANSEN_API_KEY: "from-shell" }, file);
    expect(env.ETHERSCAN_API_KEY).toBe("from-file");
    expect(env.NANSEN_API_KEY).toBe("from-shell");
    expect(env.ZERION_API_KEY).toBe("");
  });

  test("puts the pinned Bun first on PATH: the CLI compiles TypeScript workflows with it", () => {
    const env = simulationEnv({ PATH: "C:\\elsewhere" }, NO_FILE);
    const path = String(env.PATH ?? env.Path);
    expect(path.endsWith("C:\\elsewhere")).toBe(true);
    expect(path.length).toBeGreaterThan("C:\\elsewhere".length);
  });

  test("the evidence preflight names a secret variable left unset, instead of letting the CLI abort mid-run", () => {
    const deployment = {
      chainId: 10143,
      contracts: Object.fromEntries(
        ["CollectionsReceiver", "PolarisLoanEngine", "PolarisPayments", "PolarisCheckout", "GuardianReceiver"].map((c, i) => [
          c,
          { address: `0x${(i + 1).toString(16).padStart(40, "0")}` },
        ]),
      ),
    };
    const base = {
      whoami: { loggedIn: true, deployAccess: null },
      deployment,
      deploymentFile: "deployments/monad-testnet.json",
      target: "staging-settings",
      workflows: ["collections", "guardian"],
      root: ROOT,
    };
    expect(preflight({ ...base, env: simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY }, NO_FILE) })).toEqual([]);
    const problems = preflight({ ...base, env: { CRE_ETH_PRIVATE_KEY: KEY } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("POLARIS_CALLBACK_SECRET (secret POLARIS_CALLBACK_SECRET, collections) is not set");
    expect(problems[0]).toContain("environment variable POLARIS_CALLBACK_SECRET for secret value not found");
    // The guardian alone needs nothing but the transmitter key.
    expect(preflight({ ...base, workflows: ["guardian"], env: { CRE_ETH_PRIVATE_KEY: KEY } })).toEqual([]);
  });
});

describe("an evidence run's own config", () => {
  const underwriting = JSON.parse(read("underwriting/config.staging.json"));
  const collections = JSON.parse(read("collections/config.staging.json"));
  const guardian = JSON.parse(read("guardian/config.staging.json"));
  const secretsNames = parseSecretsNames(read("secrets.yaml"));

  test("underwriting without keys: every paid provider is left out, so the enclave is never sent an empty key", () => {
    expect(underwriting.confidentialHttp).toBe(true);
    const env = simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY }, NO_FILE);
    const change = runConfig("underwriting", underwriting, { env, secretsNames });
    expect(change.leftOut).toEqual(["nansen", "zerion", "zerionBasicAuth", "etherscan"]);
    expect(change.config.secrets).toEqual({ nansen: null, zerion: null, zerionBasicAuth: null, etherscan: null });
    // Everything else is the committed config.
    expect({ ...change.config, secrets: underwriting.secrets }).toEqual(underwriting);
  });

  test("with an Etherscan key only, Etherscan stays and the others are left out; the derived Zerion credential counts as a key", () => {
    const env = simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY, ETHERSCAN_API_KEY: "es-key" }, NO_FILE);
    expect(withoutMissingKeys(underwriting, secretsNames, env).config.secrets).toEqual({
      nansen: null,
      zerion: null,
      zerionBasicAuth: null,
      etherscan: "ETHERSCAN_API_KEY",
    });
    const zerion = simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY, ZERION_API_KEY: "zk" }, NO_FILE);
    expect(withoutMissingKeys(underwriting, secretsNames, zerion).leftOut).toEqual(["nansen", "etherscan"]);
    const all = simulationEnv({ NANSEN_API_KEY: "n", ZERION_API_KEY: "z", ETHERSCAN_API_KEY: "e" }, NO_FILE);
    expect(runConfig("underwriting", underwriting, { env: all, secretsNames })).toBeNull();
  });

  test("--callback: collections and underwriting post to it for this run only; the guardian has no callback", () => {
    const env = simulationEnv({ NANSEN_API_KEY: "n", ZERION_API_KEY: "z", ETHERSCAN_API_KEY: "e" }, NO_FILE);
    const url = "http://127.0.0.1:3000/api/cre/callback";
    expect(collections.callback).toBeNull();
    const c = runConfig("collections", collections, { env, secretsNames, callback: url });
    expect(c.config.callback).toEqual({ url, secretId: "POLARIS_CALLBACK_SECRET" });
    expect(c.callback).toBe(url);
    expect(runConfig("underwriting", underwriting, { env, secretsNames, callback: url }).config.callback).toEqual({ url, secretId: "POLARIS_CALLBACK_SECRET" });
    expect(runConfig("guardian", guardian, { env, secretsNames, callback: url })).toBeNull();
    expect(runConfig("collections", collections, { env, secretsNames })).toBeNull();
  });

  test("the override reaches the CLI as --config, for the cron and the log trigger alike", () => {
    const file = "C:/tmp/underwriting.staging.json";
    expect(simulateArgs("underwriting", "staging-settings", null, file)).toEqual([
      "workflow",
      "simulate",
      "./underwriting",
      "-T",
      "staging-settings",
      "--non-interactive",
      "--trigger-index",
      "0",
      "--config",
      file,
      "--broadcast",
      "--http-payload",
      "./underwriting/payload.json",
    ]);
    const retry = simulateArgs("collections", "staging-settings", { txHash: `0x${"ab".repeat(32)}`, eventIndex: 1 }, file);
    expect(retry.slice(retry.indexOf("--config"), retry.indexOf("--config") + 2)).toEqual(["--config", file]);
    expect(simulateArgs("guardian", "staging-settings")).not.toContain("--config");
  });

  test("the CLI gets a short relative --config path, not the long absolute one", () => {
    // cre workflow simulate refuses a config path over 97 characters; a nested
    // worktree's absolute path to underwriting.staging.json is 100.
    const root = "F:/Projects/polaris/.claude/worktrees/cl-integration/workflows";
    const file = `${root}/.local/evidence/underwriting.staging.json`;
    expect(file.length).toBeGreaterThan(97);
    const arg = cliConfigArg(file, `${root}/underwriting`);
    // resolved by the CLI against the workflow's own folder
    expect(arg).toBe("../.local/evidence/underwriting.staging.json");
    expect(arg.length).toBeLessThanOrEqual(97);
  });

  test("--callback is refused without the key that signs it, or when it is not a URL", () => {
    const deployment = { chainId: 10143, contracts: { GuardianReceiver: { address: `0x${"1".padStart(40, "0")}` } } };
    const base = {
      whoami: { loggedIn: true, deployAccess: null },
      deployment,
      deploymentFile: "d.json",
      target: "staging-settings",
      workflows: ["guardian"],
      root: ROOT,
      env: simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY }, NO_FILE),
    };
    expect(preflight({ ...base, callback: "http://127.0.0.1:3000/api/cre/callback" })[0]).toContain("--callback needs POLARIS_CALLBACK_SECRET");
    expect(preflight({ ...base, callback: "not a url" })[0]).toContain("--callback must be an http(s) URL");
    const signed = simulationEnv({ CRE_ETH_PRIVATE_KEY: KEY, POLARIS_CALLBACK_SECRET: "s3cret-value" }, NO_FILE);
    expect(preflight({ ...base, env: signed, callback: "http://127.0.0.1:3000/api/cre/callback" })).toEqual([]);
  });
});
