/**
 * One run of the `polaris-underwrite` workflow handler on the CRE SDK's test
 * runtime, against a local chain. `scripts/local-trigger.mjs` runs this file
 * with `bun test` for each trigger request (the SDK's capability mocks exist
 * only inside its `test()` scope), then posts the callback it captured.
 *
 * It is the workflow code `cre workflow build` compiles, run as
 * `cre workflow simulate --broadcast` would run it:
 *
 * - EVM: the local node (e2e/helpers/local-evm.ts), reports delivered through
 *   the deployment's MockKeystoneForwarder by its simulation transmitter;
 * - HTTP and Confidential HTTP (staging's `confidentialHttp`): Nansen,
 *   Zerion, Etherscan and the history RPCs answered from
 *   @polarispay/underwriting's synthesized fixtures, with the account given
 *   one persona's history and the linked wallet another's (no keys, no
 *   network: this is the local stand-in, and says so in its result);
 * - the signed callback: captured, and returned for the server to deliver.
 *
 * Input and output are files named in the environment (LOCAL_TRIGGER_IN,
 * LOCAL_TRIGGER_OUT), so nothing about a request is on the command line.
 */

import { expect } from "bun:test";
import type { HTTPPayload } from "@chainlink/cre-sdk";
import { cre } from "@chainlink/cre-sdk";
import { ConfidentialHttpMock, EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { join } from "node:path";
import type { Address } from "viem";
import { bridgeEvm } from "../e2e/helpers/local-evm.ts";
import { configSchema, onHttpTrigger } from "../src/underwriting/workflow.ts";
import {
  answerConfidentialFromFixtures,
  answerFromFixtures,
  cloneFixtures,
  type ConfidentialRequestLike,
  type CreRequestLike,
  type SentRequest,
  toSent,
  toSentConfidential,
} from "../test/helpers/fixtures-http.ts";
import { fs } from "../test/helpers/host.ts";

type Job = {
  rpc: string;
  deploymentFile: string;
  callback: { url: string; secret: string } | null;
  personas: { account: Address; history: Address };
  input: { user: Address; linked?: { wallet: Address } | null };
};

type Deployment = {
  chainId: number;
  deployer: Address;
  contracts: Record<string, { address: Address }>;
};

const IN = process.env.LOCAL_TRIGGER_IN ?? "";
const OUT = process.env.LOCAL_TRIGGER_OUT ?? "";

test("local underwriting trigger", async () => {
  expect(IN && OUT).toBeTruthy();
  const job = JSON.parse(fs.readFileSync(IN, "utf8")) as Job;
  const d = JSON.parse(fs.readFileSync(job.deploymentFile, "utf8")) as Deployment;
  const at = (name: string) => {
    const a = d.contracts[name]?.address;
    if (!a) throw new Error(`the deployment has no ${name}`);
    return a;
  };
  const staging = JSON.parse(fs.readFileSync(join(import.meta.dir, "..", "underwriting", "config.staging.json"), "utf8"));
  const CALLBACK_SECRET_ID = "POLARIS_CALLBACK_SECRET";
  const config = configSchema.parse({
    ...staging,
    receiver: at("UnderwritingReceiver"),
    scoreManager: at("ScoreManager"),
    forwarder: at("MockKeystoneForwarder"),
    stablecoins: [at("Stablecoin")],
    authorizedKeys: [],
    recipe: { ...staging.recipe, accountChainId: d.chainId },
    callback: job.callback ? { url: job.callback.url, secretId: CALLBACK_SECRET_ID } : null,
  });

  // The personas' histories, under the addresses that actually signed.
  const pairs = [{ from: job.personas.account, to: job.input.user }];
  if (job.input.linked?.wallet) pairs.push({ from: job.personas.history, to: job.input.linked.wallet });
  const fixtures = cloneFixtures(pairs);

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
    return answerFromFixtures(sent, fixtures);
  };
  // Staging turns on Confidential HTTP for the paid providers: answer those from the same fixtures.
  const enclave = ConfidentialHttpMock.testInstance();
  const enclaveSecrets = { NANSEN_API_KEY: "local-fixtures", ZERION_BASIC_AUTH: "bG9jYWwtZml4dHVyZXM6", ETHERSCAN_API_KEY: "local-fixtures" };
  enclave.sendRequest = (input) => answerConfidentialFromFixtures(toSentConfidential(input as unknown as ConfidentialRequestLike, enclaveSecrets), fixtures);

  const secrets = new Map([
    [
      "main",
      new Map([
        // The fixture transport ignores keys; the workflow only needs them to be present.
        ["NANSEN_API_KEY", "local-fixtures"],
        ["ZERION_API_KEY", "local-fixtures"],
        ["ETHERSCAN_API_KEY", "local-fixtures"],
        [CALLBACK_SECRET_ID, job.callback?.secret ?? "unused"],
      ]),
    ],
  ]);
  const payload = { input: new TextEncoder().encode(JSON.stringify(job.input)) } as unknown as HTTPPayload;
  const result = JSON.parse(onHttpTrigger(newTestRuntime(secrets, { timeProvider: () => Date.now() }, config), payload));
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      result,
      writes: record.writes.map((w) => ({ receiver: w.receiver, txHash: w.txHash, gasUsed: w.gasUsed.toString() })),
      callbacks: callbacks.map((c) => ({ url: c.url, body: c.body ?? "", signature: c.headers["polaris-signature"] ?? "" })),
    }),
  );
});
