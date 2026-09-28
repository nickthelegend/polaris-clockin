/**
 * One run of the `polaris-guardian` workflow (its cron trigger) on the CRE
 * SDK's test runtime, against a local chain. `scripts/local-guardian.mjs`
 * runs this file with `bun test` on a timer, the way a deployed workflow's
 * cron would.
 *
 * It is the workflow code `cre workflow build` compiles, with two EVM
 * clients, as on Monad testnet:
 *
 * - the pool's chain (the workflow's `monad-testnet`): the local node, for
 *   GuardianReceiver's `currentInputs()`, `creditStatus()` and
 *   `latestAttestation()`, and the write, delivered through the
 *   deployment's MockKeystoneForwarder by the deployer (the local simulation
 *   transmitter);
 * - the price: with `price: "mainnet"`, Chainlink's AUSD/USD Data Feed on
 *   Monad mainnet, read over its public RPC by a read-only bridge that
 *   refuses any write (e2e/helpers/local-evm.ts `bridgeReadOnlyEvm`); with
 *   `price: "mock"`, the local chain's MockAusdUsdFeed, which every result
 *   labels "mock".
 *
 * The thresholds are GuardianReceiver's own (the owner sets them on chain),
 * so raising the depeg threshold above the real price is how the demo shows
 * a pause without faking a price.
 *
 * Input and output are files named in the environment (LOCAL_GUARDIAN_IN,
 * LOCAL_GUARDIAN_OUT).
 */

import { expect } from "bun:test";
import { type CronPayload, cre } from "@chainlink/cre-sdk";
import { EvmMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { join } from "node:path";
import { bridgeEvm, bridgeReadOnlyEvm, chainNowMs } from "../e2e/helpers/local-evm.ts";
import { configSchema, onCron } from "../src/guardian/workflow.ts";
import { fs } from "../test/helpers/host.ts";
import { type LocalDeployment, localGuardianConfig, MONAD_MAINNET_CHAIN_ID, MONAD_MAINNET_RPC, type PriceSource } from "./config.ts";

export type GuardianJob = {
  rpc: string;
  deploymentFile: string;
  everySeconds: number;
  price: PriceSource;
  /** The Monad mainnet RPC for the feed (default the public one). */
  mainnetRpc?: string;
};

const IN = process.env.LOCAL_GUARDIAN_IN ?? "";
const OUT = process.env.LOCAL_GUARDIAN_OUT ?? "";
const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const SELECTORS = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS as Record<string, bigint>;

test("local guardian run", async () => {
  expect(IN && OUT).toBeTruthy();
  const job = readJson(IN) as GuardianJob;
  const d = readJson(job.deploymentFile) as LocalDeployment;
  const templates = {
    collections: readJson(join(ROOT, "collections", "config.staging.json")),
    underwriting: readJson(join(ROOT, "underwriting", "config.staging.json")),
    guardian: readJson(join(ROOT, "guardian", "config.staging.json")),
  };
  const config = configSchema.parse(localGuardianConfig(d, templates, { everySeconds: job.everySeconds, price: job.price }));

  const pool = bridgeEvm(EvmMock.testInstance(SELECTORS[config.chainSelectorName]!), { url: job.rpc, forwarder: config.forwarder, transmitter: d.deployer });
  const feed =
    config.priceFeed.chainSelectorName === config.chainSelectorName
      ? null
      : bridgeReadOnlyEvm(EvmMock.testInstance(SELECTORS[config.priceFeed.chainSelectorName]!), { url: job.mainnetRpc || MONAD_MAINNET_RPC, chainId: MONAD_MAINNET_CHAIN_ID });

  const nowMs = chainNowMs(job.rpc);
  const payload = { scheduledExecutionTime: { seconds: BigInt(Math.floor(nowMs / 1000)), nanos: 0 } } as unknown as CronPayload;
  const logs: string[] = [];
  const runtime = newTestRuntime(null, { timeProvider: () => chainNowMs(job.rpc) }, config);
  const log = runtime.log.bind(runtime);
  runtime.log = (message: string) => {
    logs.push(message);
    log(message);
  };
  const result = JSON.parse(onCron(runtime, payload));
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      result,
      logs,
      reads: { pool: pool.reads, feed: feed?.reads ?? 0 },
      writes: pool.writes.map((w) => ({ receiver: w.receiver, txHash: w.txHash, gasUsed: w.gasUsed.toString() })),
    }),
  );
});
