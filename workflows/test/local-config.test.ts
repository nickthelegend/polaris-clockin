/**
 * The configs the local runners (collections:local, guardian:local) build
 * for demo:local from the staging templates and the local deployment.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { everyCron, localCollectionsConfig, localGuardianConfig, MAINNET_AUSD_USD, rungWindow } from "../local/config.ts";
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
const collectionsOpts = { everySeconds: 60, callbackUrl: "http://localhost:3100/api/cre/callback" };
const guardianOpts = { everySeconds: 30, price: "mainnet" as const };
/** What demo:local writes when the guardian reads the mainnet feed: the record names Chainlink's feed. */
const MAINNET_RECORD = { chainId: 143, chainSelectorName: "monad-mainnet", address: MAINNET_AUSD_USD.address, decimals: 8, description: "AUSD / USD", kind: "chainlink" };

describe("local runner configs", () => {
  test("deliver through the forwarder the deployment records, else its MockKeystoneForwarder; no indexer", () => {
    expect(localCollectionsConfig(deployment(addr(0xf0)), templates(), collectionsOpts).forwarder).toBe(addr(0xf0));
    expect(localGuardianConfig(deployment(addr(0xf0)), templates(), guardianOpts).forwarder).toBe(addr(0xf0));
    const own = localCollectionsConfig(deployment(), templates(), collectionsOpts);
    expect(own.forwarder).toBe(addr(0x2009));
    expect(own.candidates.indexerUrl).toBeNull();
    expect(own.receiver).toBe(addr(0x2004));
    expect(own.retry).toEqual({ checkout: addr(0x2006), confidence: "FINALIZED" });
    expect(own.callback).toEqual({ url: collectionsOpts.callbackUrl, secretId: "POLARIS_CALLBACK_SECRET" });
  });

  test("the guardian reads Chainlink AUSD/USD on Monad mainnet, or the labelled local mock, never a mock called Chainlink", () => {
    expect(localGuardianConfig(deployment(), templates(), guardianOpts).priceFeed).toEqual(MAINNET_AUSD_USD);
    const mock = localGuardianConfig(deployment(), templates(), { ...guardianOpts, price: "mock" }).priceFeed;
    expect(mock).toEqual({ chainSelectorName: "monad-testnet", address: addr(0x2008), decimals: 8, description: MOCK_FEED.description, kind: "mock" });
    const mainnet = deployment();
    mainnet.cre.workflows.guardian.priceFeed = MAINNET_RECORD as typeof MOCK_FEED & { chainSelectorName: string };
    expect(localGuardianConfig(mainnet, templates(), guardianOpts).priceFeed).toEqual(MAINNET_AUSD_USD);
    expect(() => localGuardianConfig(mainnet, templates(), { ...guardianOpts, price: "mock" })).toThrow(/refusing to call it Chainlink/);
  });

  test("collections ignores which feed the guardian reads (demo:local's record names the mainnet feed)", () => {
    const mainnet = deployment();
    mainnet.cre.workflows.guardian.priceFeed = MAINNET_RECORD as typeof MOCK_FEED & { chainSelectorName: string };
    expect(localCollectionsConfig(mainnet, templates(), collectionsOpts).receiver).toBe(addr(0x2004));
  });

  test("a run that starts late still makes the first rung: the window outlasts the interval", () => {
    const c = localCollectionsConfig(deployment(), templates(), collectionsOpts);
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
    expect(localGuardianConfig(deployment(), templates(), guardianOpts).schedule).toBe("*/30 * * * * *");
  });
});
