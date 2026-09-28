/**
 * The configs the local runners (collections:local, guardian:local) build
 * for demo:local from the staging templates and the local deployment.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { everyCron, localConfigs, MAINNET_AUSD_USD, rungWindow } from "../local/config.ts";
import { onRung } from "../src/collections/backoff.ts";
import { fs } from "./helpers/host.ts";

const ROOT = join(import.meta.dir, "..");
const json = (p: string) => JSON.parse(fs.readFileSync(join(ROOT, p), "utf8"));
const templates = () => ({
  collections: json("collections/config.staging.json"),
  underwriting: json("underwriting/config.staging.json"),
  guardian: json("guardian/config.staging.json"),
});
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const MOCK_FEED = { chainId: 31337, chainSelectorName: null, address: addr(0x2008), decimals: 8, description: "AUSD / USD (local mock, not Chainlink)", kind: "mock" };
const NAMES = ["Stablecoin", "ScoreManager", "PolarisLoanEngine", "PolarisPayments", "CollectionsReceiver", "UnderwritingReceiver", "PolarisCheckout", "GuardianReceiver", "MockAusdUsdFeed", "MockKeystoneForwarder"];
/** A demo:local record: its own MockKeystoneForwarder, the deployer as the simulation transmitter. */
const deployment = (forwarder?: `0x${string}`) => ({
  chainId: 31337,
  deployer: addr(0xd0),
  contracts: Object.fromEntries(NAMES.map((n, i) => [n, { address: addr(0x2000 + i) }])),
  cre: { forwarderKind: "local", ...(forwarder ? { forwarder } : {}), workflows: { guardian: { name: "polaris-guardian", priceFeed: MOCK_FEED } } },
});
const opts = { collectionsEverySeconds: 60, guardianEverySeconds: 30, price: "mainnet" as const, callbackUrl: "http://localhost:3100/api/cre/callback" };

describe("local runner configs", () => {
  test("deliver through the forwarder the deployment records, else its MockKeystoneForwarder; no indexer", () => {
    const recorded = localConfigs(deployment(addr(0xf0)), templates(), opts);
    expect(recorded.collections.forwarder).toBe(addr(0xf0));
    expect(recorded.guardian.forwarder).toBe(addr(0xf0));
    const own = localConfigs(deployment(), templates(), opts);
    expect(own.collections.forwarder).toBe(addr(0x2009));
    expect(own.collections.candidates.indexerUrl).toBeNull();
    expect(own.collections.receiver).toBe(addr(0x2004));
    expect(own.collections.retry).toEqual({ checkout: addr(0x2006), confidence: "FINALIZED" });
    expect(own.collections.callback).toEqual({ url: opts.callbackUrl, secretId: "POLARIS_CALLBACK_SECRET" });
  });

  test("the guardian reads Chainlink AUSD/USD on Monad mainnet, or the labelled local mock, never a mock called Chainlink", () => {
    expect(localConfigs(deployment(), templates(), opts).guardian.priceFeed).toEqual(MAINNET_AUSD_USD);
    const mock = localConfigs(deployment(), templates(), { ...opts, price: "mock" }).guardian.priceFeed;
    expect(mock).toEqual({ chainSelectorName: "monad-testnet", address: addr(0x2008), decimals: 8, description: MOCK_FEED.description, kind: "mock" });
    const mislabelled = deployment();
    mislabelled.cre.workflows.guardian.priceFeed = { ...MOCK_FEED, kind: "chainlink" };
    expect(() => localConfigs(mislabelled, templates(), { ...opts, price: "mock" })).toThrow(/refusing to call it Chainlink/);
  });

  test("a run that starts late still makes the first rung: the window outlasts the interval", () => {
    const c = localConfigs(deployment(), templates(), opts).collections;
    const ladder = c.candidates.chainBackoff!;
    expect(ladder.windowSeconds).toBe(rungWindow(60));
    // Due at t=1000; runs every 60 s but each 20 s late. Before, the 30 s window of `configure local` let
    // an instalment fall between two runs and wait 6 h for the next rung.
    const due = 1000;
    const runs = [1041, 1101];
    expect(runs.some((t) => onRung(t, due, { ...ladder, windowSeconds: 30 }))).toBe(false);
    expect(runs.some((t) => onRung(t, due, ladder))).toBe(true);
  });

  test("the schedule matches the runner's interval", () => {
    expect(everyCron(30)).toBe("*/30 * * * * *");
    expect(everyCron(60)).toBe("0 */1 * * * *");
    expect(everyCron(600)).toBe("0 */10 * * * *");
    expect(() => everyCron(45)).toThrow(/divide a minute/);
    expect(localConfigs(deployment(), templates(), opts).guardian.schedule).toBe("*/30 * * * * *");
  });
});
