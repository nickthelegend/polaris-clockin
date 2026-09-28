/**
 * One run of the `polaris-collections` workflow on the CRE SDK's test
 * runtime, against a local chain, from either of its two triggers:
 *
 * - `cron`: `onCron`, the scheduled run (due instalments and renewals);
 * - `log`: `onReauthorized`, the EVM log trigger on PolarisCheckout's
 *   `Reauthorized`, handed the log from the transaction's real receipt (as
 *   `cre workflow simulate --evm-tx-hash <tx> --evm-event-index <i>` builds
 *   it from Monad testnet): the instant retry after a buyer signs again.
 *
 * `scripts/local-collections.mjs` runs this file with `bun test` (the SDK's
 * capability mocks exist only inside its `test()` scope): on a timer for the
 * cron, and for each `Reauthorized` log the local chain emits.
 *
 * It is the workflow code `cre workflow build` compiles, run as
 * `cre workflow simulate --broadcast` would run it:
 *
 * - config: the staging template filled from the deployment record
 *   (./config.ts), with the deployment's own MockKeystoneForwarder;
 * - candidates from the chain (`loanCount`, `subscriptionCount` and a window
 *   of ids): no indexer locally;
 * - EVM: the local node (e2e/helpers/local-evm.ts), the report delivered
 *   through the MockKeystoneForwarder by the deployer, the local simulation
 *   transmitter; CollectionsReceiver collects what is due;
 * - the workflow's signed `collections.run` callback (when a task moved or
 *   failed): captured, and returned for the runner to deliver; and, for a
 *   cron run, a signed `collections.heartbeat`, idle or not, so the
 *   dashboard's Collections card knows the runner is alive.
 *
 * Input and output are files named in the environment (LOCAL_COLLECTIONS_IN,
 * LOCAL_COLLECTIONS_OUT).
 */

import { expect } from "bun:test";
import type { CronPayload } from "@chainlink/cre-sdk";
import { cre } from "@chainlink/cre-sdk";
import { EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { join } from "node:path";
import type { Hex } from "viem";
import { bridgeEvm, chainNowMs, logTriggerPayload, type RpcReceipt, rpcSync } from "../e2e/helpers/local-evm.ts";
import { REAUTHORIZED_TOPIC } from "../src/collections/retry.ts";
import { configSchema, onCron, onReauthorized } from "../src/collections/workflow.ts";
import { signCallback } from "../src/shared/callback.ts";
import { type CreRequestLike, type SentRequest, toSent } from "../test/helpers/fixtures-http.ts";
import { fs } from "../test/helpers/host.ts";
import { CALLBACK_SECRET_ID, type LocalDeployment, localConfigs } from "./config.ts";

export type CollectionsJob = {
  rpc: string;
  deploymentFile: string;
  callback: { url: string; secret: string } | null;
  /** Seconds between cron runs (sets the dunning ladder's window). */
  everySeconds: number;
  trigger: { kind: "cron" } | { kind: "log"; txHash: Hex };
};

const IN = process.env.LOCAL_COLLECTIONS_IN ?? "";
const OUT = process.env.LOCAL_COLLECTIONS_OUT ?? "";
const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

test("local collections run", async () => {
  expect(IN && OUT).toBeTruthy();
  const job = readJson(IN) as CollectionsJob;
  const d = readJson(job.deploymentFile) as LocalDeployment;
  const templates = {
    collections: readJson(join(ROOT, "collections", "config.staging.json")),
    underwriting: readJson(join(ROOT, "underwriting", "config.staging.json")),
    guardian: readJson(join(ROOT, "guardian", "config.staging.json")),
  };
  const { collections } = localConfigs(d, templates, {
    collectionsEverySeconds: job.everySeconds,
    guardianEverySeconds: 30,
    price: "mock",
    callbackUrl: job.callback?.url ?? null,
  });
  const config = configSchema.parse(collections);

  const selector = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName as keyof typeof cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS];
  const record = bridgeEvm(EvmMock.testInstance(selector), { url: job.rpc, forwarder: config.forwarder, transmitter: d.deployer });
  const callbacks: SentRequest[] = [];
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (input) => {
    const sent = toSent(input as unknown as CreRequestLike);
    if (job.callback && sent.url === job.callback.url) {
      callbacks.push(sent);
      return { statusCode: 204 };
    }
    return { statusCode: 404 };
  };

  const secrets = new Map([["main", new Map([[CALLBACK_SECRET_ID, job.callback?.secret ?? "unused"]])]]);
  // The DON's clock is the chain's (the runner mines a block first, so it is now).
  const runtime = () => newTestRuntime(secrets, { timeProvider: () => chainNowMs(job.rpc) }, config);
  let result: { status: string; checked: number; tasks: unknown[]; executed: number; skipped: number; txHash: string | null };
  if (job.trigger.kind === "log") {
    const receipt = rpcSync<RpcReceipt | null>(job.rpc, "eth_getTransactionReceipt", [job.trigger.txHash]);
    if (!receipt) throw new Error(`no receipt for ${job.trigger.txHash}`);
    const checkout = config.retry?.checkout?.toLowerCase();
    // The log's position in the receipt, as --evm-event-index counts it.
    const index = receipt.logs.findIndex((l) => l.address.toLowerCase() === checkout && l.topics[0]?.toLowerCase() === REAUTHORIZED_TOPIC);
    if (index < 0) throw new Error(`${job.trigger.txHash} has no Reauthorized log from PolarisCheckout ${config.retry?.checkout}`);
    result = JSON.parse(onReauthorized(runtime(), logTriggerPayload(receipt, index)));
  } else {
    const nowMs = chainNowMs(job.rpc);
    const payload = { scheduledExecutionTime: { seconds: BigInt(Math.floor(nowMs / 1000)), nanos: 0 } } as unknown as CronPayload;
    result = JSON.parse(onCron(runtime(), payload));
  }

  const sent = callbacks.map((c) => ({ url: c.url, body: c.body ?? "", signature: c.headers["polaris-signature"] ?? c.headers["Polaris-Signature"] ?? "" }));
  if (job.callback && job.trigger.kind === "cron") {
    const seconds = Math.floor(chainNowMs(job.rpc) / 1000);
    const body = JSON.stringify({
      id: `heartbeat-${seconds}`,
      type: "collections.heartbeat",
      createdAt: seconds,
      status: result.status,
      checked: result.checked,
      tasks: result.tasks.length,
      executed: result.executed,
      skipped: result.skipped,
      txHash: result.txHash,
    });
    sent.push({ url: job.callback.url, body, signature: signCallback(job.callback.secret, body, seconds) });
  }
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      result,
      writes: record.writes.map((w) => ({ receiver: w.receiver, txHash: w.txHash, gasUsed: w.gasUsed.toString() })),
      callbacks: sent,
    }),
  );
});
