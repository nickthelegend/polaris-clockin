/**
 * The committed configs, and what `configure` writes into them.
 *
 * Staging and production ship without contract addresses because none are
 * deployed yet (packages/contracts/deployments/monad-testnet.json does not
 * exist): the schema refuses them with the command that fills them, and
 * nothing else in them may be wrong.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { configSchema as collectionsSchema } from "../src/collections/workflow.ts";
import { configSchema as underwritingSchema } from "../src/underwriting/workflow.ts";
import { fs } from "./helpers/host.ts";
// @ts-expect-error: a plain ESM script, no type declarations
import { configsFor, FORWARDERS, MONAD_TESTNET_USDC } from "../scripts/configure.mjs";

const ROOT = join(import.meta.dir, "..");
const json = (p: string) => JSON.parse(fs.readFileSync(join(ROOT, p), "utf8"));

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const record = (forwarderKind: string, forwarder: string, workflowOwner: string | null = null) => ({
  network: "monadTestnet",
  chainId: 10143,
  contracts: Object.fromEntries(
    ["Stablecoin", "ScoreManager", "PolarisLoanEngine", "PolarisPayments", "CollectionsReceiver", "UnderwritingReceiver"].map((n, i) => [
      n,
      { address: addr(0x1000 + i) },
    ]),
  ),
  cre: {
    forwarderKind,
    forwarder,
    workflowOwner,
    workflows: { collections: { name: "polaris-collections" }, underwrite: { name: "polaris-underwrite" } },
  },
});

describe("committed configs", () => {
  for (const target of ["staging", "production"]) {
    test(`${target}: only the undeployed addresses are missing, and the error says how to fill them`, () => {
      for (const [w, schema] of [
        ["collections", collectionsSchema],
        ["underwriting", underwritingSchema],
      ] as const) {
        const r = schema.safeParse(json(`${w}/config.${target}.json`));
        expect(r.success).toBe(false);
        const paths = r.error!.issues.map((i) => i.path.join("."));
        const allowed = ["receiver", "loanEngine", "payments", "scoreManager", "authorizedKeys"];
        expect(paths.every((p) => allowed.includes(p))).toBe(true);
        expect(r.error!.issues.find((i) => i.path[0] === "receiver")?.message).toContain("pnpm --filter @polaris/cre-workflows configure");
      }
    });
  }

  test("the demo (staging) cadence is every minute, production's is daily", () => {
    expect(json("collections/config.staging.json").schedule).toBe("0 * * * * *");
    expect(json("collections/config.production.json").schedule).toBe("0 0 14 * * *");
  });

  test("Confidential HTTP is on where the workflows are simulated, off until a deployed DON shows it serves it", () => {
    expect(json("underwriting/config.staging.json").confidentialHttp).toBe(true);
    expect(json("underwriting/config.production.json").confidentialHttp).toBe(false);
    for (const t of ["staging", "production"]) {
      expect(json(`underwriting/config.${t}.json`).secrets.zerionBasicAuth).toBe("ZERION_BASIC_AUTH");
    }
    // Every secret id the configs name is one secrets.yaml maps for simulation and the Vault DON.
    const yaml = fs.readFileSync(join(ROOT, "secrets.yaml"), "utf8");
    const mapped = [...yaml.matchAll(/^ {2}([A-Z_]+):$/gm)].map((m) => m[1]);
    for (const id of Object.values(json("underwriting/config.staging.json").secrets) as string[]) expect(mapped).toContain(id);
  });
});

describe("configure", () => {
  const templates = (target: string) => ({
    collections: json(`collections/config.${target}.json`),
    underwriting: json(`underwriting/config.${target}.json`),
  });

  test("staging: fills the addresses from the deployment and parses", () => {
    const out = configsFor("staging", record("simulation", FORWARDERS.simulation), templates("staging"));
    const c = collectionsSchema.parse(out.collections);
    const u = underwritingSchema.parse(out.underwriting);
    expect(c.receiver).toBe(addr(0x1004));
    expect(c.forwarder).toBe(FORWARDERS.simulation);
    expect(u.stablecoins).toEqual([addr(0x1000), MONAD_TESTNET_USDC]);
  });

  test("staging refuses a deployment whose receivers trust the production forwarder", () => {
    expect(() => configsFor("staging", record("production", FORWARDERS.production), templates("staging"))).toThrow(/simulates through/);
  });

  test("production needs receivers on the production forwarder, and the API's trigger key", () => {
    expect(() => configsFor("production", record("simulation", FORWARDERS.simulation), templates("production"))).toThrow(/production KeystoneForwarder/);
    const out = configsFor("production", record("production", FORWARDERS.production), templates("production"), { authorizedKey: addr(0xabc) });
    expect(collectionsSchema.parse(out.collections).forwarder).toBe(FORWARDERS.production);
    expect(underwritingSchema.parse(out.underwriting).authorizedKeys).toEqual([addr(0xabc)]);
    // Without the key the underwriting config stays refused, with the reason.
    const keyless = configsFor("production", record("production", FORWARDERS.production), templates("production"));
    expect(underwritingSchema.safeParse(keyless.underwriting).error?.issues[0]?.message).toContain("authorizedKeys is not set");
  });

  test("local: the local cron's pace, one attempt per rung of the ladder, Confidential HTTP as in staging", () => {
    const out = configsFor("local", record("simulation", FORWARDERS.simulation), templates("staging"));
    const c = collectionsSchema.parse(out.collections);
    expect(c.schedule).toBe("*/30 * * * * *");
    expect(c.candidates.chainBackoff).toEqual({ ladderSeconds: [21_600, 86_400, 259_200, 604_800], windowSeconds: 30 });
    expect(underwritingSchema.parse(out.underwriting).confidentialHttp).toBe(true);
  });

  test("--indexer and --callback", () => {
    const out = configsFor("staging", record("simulation", FORWARDERS.simulation), templates("staging"), {
      indexer: "https://indexer.dev.hyperindex.xyz/abc/v1/graphql",
      callback: "https://business.polarispay.app/api/cre/events",
    });
    expect(out.collections.candidates.indexerUrl).toBe("https://indexer.dev.hyperindex.xyz/abc/v1/graphql");
    expect(out.underwriting.callback).toEqual({ url: "https://business.polarispay.app/api/cre/events", secretId: "POLARIS_CALLBACK_SECRET" });
  });
});
