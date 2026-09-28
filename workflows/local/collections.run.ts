/**
 * One run of the `polaris-collections` workflow handler (its cron trigger)
 * on the CRE SDK's test runtime, against a local chain.
 * `scripts/local-collections.mjs` runs this file with `bun test` on a timer
 * (the SDK's capability mocks exist only inside its `test()` scope), then
 * posts the callbacks it captured.
 *
 * It is the workflow code `cre workflow build` compiles, run as
 * `cre workflow simulate --broadcast` would run it:
 *
 * - candidates from the chain (`loanCount`, `subscriptionCount` and a window
 *   of ids): no indexer locally;
 * - EVM: the local node (e2e/helpers/local-evm.ts), the report delivered
 *   through the deployment's MockKeystoneForwarder by its simulation
 *   transmitter; CollectionsReceiver collects the instalments that are due;
 * - the workflow's signed `collections.run` callback (when a task moved or
 *   failed): captured, and returned for the server to deliver; and a signed
 *   `collections.heartbeat` for every run, idle or not, so the dashboard's
 *   Collections card knows the runner is alive.
 *
 * Input and output are files named in the environment (LOCAL_COLLECTIONS_IN,
 * LOCAL_COLLECTIONS_OUT).
 */

import { expect } from "bun:test";
import type { CronPayload } from "@chainlink/cre-sdk";
import { cre } from "@chainlink/cre-sdk";
import { EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { join } from "node:path";
import type { Address } from "viem";
import { bridgeEvm, chainNowMs } from "../e2e/helpers/local-evm.ts";
import { signCallback } from "../src/shared/callback.ts";
import { configSchema, onCron } from "../src/collections/workflow.ts";
import { type CreRequestLike, type SentRequest, toSent } from "../test/helpers/fixtures-http.ts";
import { fs } from "../test/helpers/host.ts";

type Job = {
  rpc: string;
  deploymentFile: string;
  callback: { url: string; secret: string } | null;
};

type Deployment = {
  chainId: number;
  deployer: Address;
  contracts: Record<string, { address: Address }>;
};

const IN = process.env.LOCAL_COLLECTIONS_IN ?? "";
const OUT = process.env.LOCAL_COLLECTIONS_OUT ?? "";

test("local collections run", async () => {
  expect(IN && OUT).toBeTruthy();
  const job = JSON.parse(fs.readFileSync(IN, "utf8")) as Job;
  const d = JSON.parse(fs.readFileSync(job.deploymentFile, "utf8")) as Deployment;
  const at = (name: string) => {
    const a = d.contracts[name]?.address;
    if (!a) throw new Error(`the deployment has no ${name}`);
    return a;
  };
  const local = JSON.parse(fs.readFileSync(join(import.meta.dir, "..", "collections", "config.local.json"), "utf8"));
  const SECRET_ID = "POLARIS_CALLBACK_SECRET";
  const config = configSchema.parse({
    ...local,
    receiver: at("CollectionsReceiver"),
    loanEngine: at("PolarisLoanEngine"),
    payments: at("PolarisPayments"),
    forwarder: at("MockKeystoneForwarder"),
    candidates: { ...local.candidates, indexerUrl: null },
    callback: job.callback ? { url: job.callback.url, secretId: SECRET_ID } : null,
  });

  const selector = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName as keyof typeof cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS];
  const record = bridgeEvm(EvmMock.testInstance(selector), { url: job.rpc, forwarder: at("MockKeystoneForwarder"), transmitter: d.deployer });
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

  const secrets = new Map([["main", new Map([[SECRET_ID, job.callback?.secret ?? "unused"]])]]);
  // The DON's clock is the chain's (the runner mines a block first, so it is now).
  const nowMs = chainNowMs(job.rpc);
  const payload = { scheduledExecutionTime: { seconds: BigInt(Math.floor(nowMs / 1000)), nanos: 0 } } as unknown as CronPayload;
  const result = JSON.parse(onCron(newTestRuntime(secrets, { timeProvider: () => chainNowMs(job.rpc) }, config), payload));

  const sent = callbacks.map((c) => ({ url: c.url, body: c.body ?? "", signature: c.headers["polaris-signature"] ?? c.headers["Polaris-Signature"] ?? "" }));
  if (job.callback) {
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
