/**
 * The three workflows, end to end, on a local Monad stand-in (Hardhat, chain
 * 10143) with every Polaris contract deployed by packages/contracts' own
 * deploy script, reports delivered through the mock forwarder planted at
 * Chainlink's simulation-forwarder address:
 *
 *   pnpm --filter @polaris/cre-workflows e2e:local
 *
 * The workflow code is the code `cre workflow build` compiles, run by the
 * CRE SDK's test runtime; its EVM capability is bridged to the node (see
 * helpers/local-evm.ts) and its HTTP capability answers from the
 * underwriting fixtures. The guardian reads the local chain's MockPriceFeed
 * (labelled "local mock, not Chainlink") where staging reads Chainlink's
 * AUSD/USD on Monad mainnet; the log trigger's payload is built from the real
 * `reauthorize` receipt, as `cre workflow simulate --evm-tx-hash` builds it. So the receivers decode the exact bytes the
 * workflows encode, and ScoreManager and PolarisLoanEngine act on them.
 *
 *   1. underwriting: the account's consent + a Bring-your-history proof → facts → ScoreManager opens a line;
 *      a brand-new account alone is a thin file: no report, no line
 *   2. guardian: a healthy first attestation (GuardianReceiver decodes and re-evaluates the workflow's
 *      bytes); the owner raises the depeg threshold → Pay in 4 paused (openPlan reverts
 *      CreditPausedByGuardian(1)) → restored → resumed; a depeg and a stale round on the local mock
 *   3. a Pay in 4 plan opens on that line (PlanIntent + Permit, relayed), so the resume is real
 *   4. collections, candidates from the indexer: instalment 1 collected, webhook posted
 *   5. the instant retry: allowance revoked → dunned (allowance_lost) → the ladder would wait 6 h →
 *      the buyer re-signs (PolarisCheckout.reauthorize) → the EVM-log-triggered run collects in the next block
 *   6. the buyer revokes the allowance → installment.failed "allowance_lost"
 *   7. the buyer's balance runs dry → installment.failed "insufficient_funds"
 *   8. past grace → the plan is liquidated
 *   9. a report with an action the receiver does not know is skipped, not fatal
 *  10. guardian after that loss: the shortfall is bad debt → Pay in 4 paused; the owner's override lifts it
 *
 * Skipped unless POLARIS_CRE_E2E_RPC and POLARIS_CRE_E2E_DEPLOYMENT are set
 * (scripts/e2e-local.mjs sets them).
 */

import { afterAll, describe, expect } from "bun:test";
import { join } from "node:path";
import { cre, type CronPayload, type HTTPPayload } from "@chainlink/cre-sdk";
import { ConfidentialHttpMock, EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import {
  collectionsReceiverAbi,
  guardianReceiverAbi,
  mockAUSDAbi,
  mockPriceFeedAbi,
  polarisCheckoutAbi,
  polarisLoanEngineAbi,
  scoreManagerAbi,
  underwritingReceiverAbi,
} from "@polarispay/contracts/abi";
import { linkMessage, scoreFromFacts } from "@polarispay/underwriting/core";
import {
  type Abi,
  type Address,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  maxUint256,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { classifySkip } from "../src/collections/outcomes.ts";
import { encodeCollectionsReport } from "../src/collections/tasks.ts";
import { REAUTHORIZED_TOPIC } from "../src/collections/retry.ts";
import { configSchema as collectionsSchema, type CollectionsConfig, onCron, onReauthorized } from "../src/collections/workflow.ts";
import { type Attestation, decodeGuardianReport, guardianReasons, type Thresholds } from "../src/guardian/attestation.ts";
import { type GuardianConfig, configSchema as guardianSchema, onCron as guardianCron } from "../src/guardian/workflow.ts";
import { verifyCallback } from "../src/shared/callback.ts";
import { underwriteConsentMessage } from "../src/underwriting/consent.ts";
import { decodeUnderwritingReport } from "../src/underwriting/report.ts";
import { configSchema as underwritingSchema, onHttpTrigger, type UnderwritingConfig } from "../src/underwriting/workflow.ts";
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
import { answerHasura, type Tables } from "../test/helpers/hasura.ts";
import { fs, requireModule } from "../test/helpers/host.ts";
import { blockTime, bridgeEvm, call, chainNowMs, logTriggerPayload, rpcSync, sendTx, travel } from "./helpers/local-evm.ts";

const RPC = process.env.POLARIS_CRE_E2E_RPC ?? "";
const DEPLOYMENT = process.env.POLARIS_CRE_E2E_DEPLOYMENT ?? "";
const enabled = RPC !== "" && DEPLOYMENT !== "";
const ROOT = join(import.meta.dir, "..");

const SELECTOR = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-testnet"];
const SIM_FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as Address;
const CALLBACK_URL = "https://api.polaris.test/v1/cre/events";
const INDEXER_URL = "https://indexer.polaris.test/v1/graphql";
const SECRET = "local-e2e-callback-secret";

// Hardhat's public default accounts (unlocked on the local node). Test-only keys.
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const RELAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const buyer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const historyWallet = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
// A brand-new account with no history: the thin file that must not get the $200 floor line.
const newcomer = privateKeyToAccount("0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97");
const SINK = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;

const REGULAR_ACCOUNT = "0xacc0000000000000000000000000000000000002";
const STRONG = "0xb0b0000000000000000000000000000000000001";
const FRESH_ACCOUNT = "0xacc0000000000000000000000000000000000001";

interface Deployment {
  deployer: Address;
  contracts: Record<string, { address: Address }>;
  demo: { merchant: Address };
  eip712: Record<string, { domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>> }>;
}

const read = (to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) =>
  decodeFunctionResult({ abi, functionName, data: call(RPC, to, encodeFunctionData({ abi, functionName, args })) });

const send = (from: Address, to: Address, abi: Abi, functionName: string, args: readonly unknown[]) =>
  sendTx(RPC, { from, to, data: encodeFunctionData({ abi, functionName, args }) });

describe.skipIf(!enabled)("on a local Monad stand-in, through the simulation forwarder", () => {
  const d = (enabled ? JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8")) : {}) as Deployment;
  const at = (name: string) => d.contracts[name]!.address;
  const FIXTURES = enabled
    ? cloneFixtures([
        { from: REGULAR_ACCOUNT, to: buyer.address },
        { from: STRONG, to: historyWallet.address },
        { from: FRESH_ACCOUNT, to: newcomer.address },
      ])
    : "";
  const secrets = new Map([
    [
      "main",
      new Map([
        ["NANSEN_API_KEY", "local-nansen"],
        ["ZERION_API_KEY", "local-zerion"],
        ["ETHERSCAN_API_KEY", "local-etherscan"],
        ["POLARIS_CALLBACK_SECRET", SECRET],
      ]),
    ],
  ]);
  /** What the Vault DON would hold; the fixture transport ignores the values. */
  const ENCLAVE_SECRETS = { NANSEN_API_KEY: "local-nansen", ZERION_BASIC_AUTH: "bG9jYWwtemVyaW9uOg==", ETHERSCAN_API_KEY: "local-etherscan" };
  const collectionsConfig = (over: Partial<CollectionsConfig> = {}): CollectionsConfig =>
    collectionsSchema.parse({
      ...JSON.parse(fs.readFileSync(join(ROOT, "collections", "config.local.json"), "utf8")),
      callback: { url: CALLBACK_URL, secretId: "POLARIS_CALLBACK_SECRET" },
      ...over,
    });
  const underwritingConfig = (): UnderwritingConfig =>
    underwritingSchema.parse(JSON.parse(fs.readFileSync(join(ROOT, "underwriting", "config.local.json"), "utf8")));

  /**
   * Wire the SDK's mocks: EVM to the node, HTTP to the fixtures, the callback
   * and an indexer. The indexer runs the workflow's own query over `indexer()`'s
   * rows against the Polaris indexer's Hasura schema, so a query that indexer
   * would refuse makes the run fall back to the chain, and the test fails.
   */
  function harness(indexer?: () => Tables) {
    const record = bridgeEvm(EvmMock.testInstance(SELECTOR), { url: RPC, forwarder: SIM_FORWARDER, transmitter: DEPLOYER });
    const callbacks: SentRequest[] = [];
    const http = HttpActionsMock.testInstance();
    http.sendRequest = (input) => {
      const s = toSent(input as unknown as CreRequestLike);
      if (s.url === CALLBACK_URL) {
        callbacks.push(s);
        return { statusCode: 204 };
      }
      if (s.url === INDEXER_URL) {
        const answer = answerHasura(s.body ?? "", indexer?.() ?? {});
        return { statusCode: 200, body: Buffer.from(JSON.stringify(answer)).toString("base64") };
      }
      return answerFromFixtures(s, FIXTURES);
    };
    // The paid providers under `confidentialHttp` (on in config.local.json, as in staging).
    const enclave = ConfidentialHttpMock.testInstance();
    enclave.sendRequest = (input) =>
      answerConfidentialFromFixtures(toSentConfidential(input as unknown as ConfidentialRequestLike, ENCLAVE_SECRETS), FIXTURES);
    return { record, callbacks };
  }

  const cronAt = (): CronPayload => ({ scheduledExecutionTime: { seconds: BigInt(Math.floor(chainNowMs(RPC) / 1000)), nanos: 0 } }) as unknown as CronPayload;
  const collect = (config: CollectionsConfig) =>
    JSON.parse(onCron(newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, config), cronAt()));

  const lastEvents = (callbacks: SentRequest[]) => {
    const c = callbacks.at(-1)!;
    expect(verifyCallback(SECRET, c.body!, c.headers["polaris-signature"], Math.floor(chainNowMs(RPC) / 1000)).ok).toBe(true);
    return JSON.parse(c.body!).events as Array<Record<string, string>>;
  };

  let loanId = 0n;
  /** Every report written, for the gas table printed at the end. */
  const written: Array<{ what: string; gasUsed: bigint; gasLimit: bigint }> = [];
  const track = (record: ReturnType<typeof bridgeEvm>, what: string) => {
    for (const w of record.writes.splice(0)) written.push({ what, gasUsed: w.gasUsed, gasLimit: w.gasLimit });
  };
  afterAll(() => {
    if (written.length === 0) return;
    console.log("\nReports delivered through the forwarder (gas used / limit sent):");
    for (const w of written) console.log(`  ${w.what.padEnd(34)} ${w.gasUsed.toString().padStart(8)} / ${w.gasLimit}`);
  });

  /** The buyer's own signature asking to be underwritten, with `wallet`'s history or alone. */
  const consentOf = async (wallet: Address | null, issuedAt: number) => {
    const nonce = "e2eConsent01";
    const chainId = underwritingConfig().recipe.accountChainId;
    const signature = await buyer.signMessage({ message: underwriteConsentMessage({ account: buyer.address, wallet, chainId, issuedAt, nonce }) });
    return { issuedAt, nonce, signature };
  };

  test("underwriting: the account's consent and the history wallet's proof become facts, and ScoreManager opens the line on chain", async () => {
    const { record } = harness();
    const now = Math.floor(chainNowMs(RPC) / 1000);
    const nonce = "e2eLocal0001";
    const signature = await historyWallet.signMessage({
      message: linkMessage({ account: buyer.address, wallet: historyWallet.address, issuedAt: now, nonce }),
    });
    const input = {
      user: buyer.address,
      consent: await consentOf(historyWallet.address, now),
      linked: { wallet: historyWallet.address, issuedAt: now, nonce, signature },
    };

    // Whoever fires the trigger cannot speak for the account: the same request with the
    // consent signed by another key is rejected, and nothing reaches the chain.
    const forged = { ...input, consent: { ...input.consent, signature: await historyWallet.signMessage({ message: "not the account" }) } };
    const refused = JSON.parse(
      onHttpTrigger(
        newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, underwritingConfig()),
        { input: new TextEncoder().encode(JSON.stringify(forged)) } as unknown as HTTPPayload,
      ),
    );
    expect(refused).toMatchObject({ status: "rejected", reason: expect.stringContaining("the account did not consent") });
    expect(record.writes).toHaveLength(0);

    const payload = { input: new TextEncoder().encode(JSON.stringify(input)) } as unknown as HTTPPayload;
    const out = JSON.parse(onHttpTrigger(newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, underwritingConfig()), payload));

    expect(out.status).toBe("applied");
    expect(record.writes).toHaveLength(1);
    const w = record.writes[0]!;
    const { items } = decodeUnderwritingReport(w.body);
    expect(items[0]!.user).toBe(buyer.address);
    expect(items[0]!.linkedWallet).toBe(historyWallet.address);
    // The chain computed the score from the facts, and it is the mirror's.
    expect(out.onChainScore).toBe(scoreFromFacts(items[0]!.facts).score);
    expect(Number(read(at("ScoreManager"), scoreManagerAbi, "scoreOf", [buyer.address]))).toBe(out.onChainScore);
    expect(read(at("UnderwritingReceiver"), underwritingReceiverAbi, "linkedUserOf", [historyWallet.address])).toBe(buyer.address);
    const limit = read(at("ScoreManager"), scoreManagerAbi, "creditLimitOf", [buyer.address]) as bigint;
    expect(limit).toBeGreaterThanOrEqual(500_000_000n);
    // Sized from an estimate: enough, and not a blanket limit.
    expect(w.gasUsed).toBeLessThanOrEqual(w.gasLimit);
    expect(w.gasLimit).toBeLessThan(w.gasUsed * 2n);
    track(record, "underwriting, 1 buyer + history");

    // A second request costs nothing: the chain already holds the record.
    const again = JSON.parse(
      onHttpTrigger(
        newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, underwritingConfig()),
        {
          input: new TextEncoder().encode(
            JSON.stringify({ user: buyer.address, consent: await consentOf(null, Math.floor(chainNowMs(RPC) / 1000)) }),
          ),
        } as unknown as HTTPPayload,
      ),
    );
    expect(again.status).toBe("skipped");
    expect(record.writes).toHaveLength(0); // nothing written the second time
  });

  test("underwriting: a brand-new account alone is a thin file: no report, and no unsecured line on chain", async () => {
    const { record } = harness();
    const now = Math.floor(chainNowMs(RPC) / 1000);
    const chainId = underwritingConfig().recipe.accountChainId;
    const nonce = "e2eNewcomer1";
    const signature = await newcomer.signMessage({
      message: underwriteConsentMessage({ account: newcomer.address, wallet: null, chainId, issuedAt: now, nonce }),
    });
    const out = JSON.parse(
      onHttpTrigger(
        newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, underwritingConfig()),
        { input: new TextEncoder().encode(JSON.stringify({ user: newcomer.address, consent: { issuedAt: now, nonce, signature } })) } as unknown as HTTPPayload,
      ),
    );
    expect(out).toMatchObject({ status: "thin", txHash: null });
    // Had it been reported, ScoreManager would have opened it at the floor: the $200 tier.
    expect(out.expectedScore).toBeLessThan(580);
    expect(record.writes).toHaveLength(0);
    const profile = read(at("ScoreManager"), scoreManagerAbi, "profileOf", [newcomer.address]) as { underwritten: boolean };
    expect(profile.underwritten).toBe(false);
    expect(read(at("ScoreManager"), scoreManagerAbi, "creditLimitOf", [newcomer.address])).toBe(0n);
  });

// ---------------------------------------------------------------- polaris-guardian

  /** GuardianReceiver.thresholds() now. */
  const thresholdsNow = (): Thresholds => {
    const t = read(at("GuardianReceiver"), guardianReceiverAbi, "thresholds") as Thresholds;
    return {
      minPrice: t.minPrice,
      maxPrice: t.maxPrice,
      minFreeCash: t.minFreeCash,
      maxBadDebtBps: Number(t.maxBadDebtBps),
      minOriginated: t.minOriginated,
      maxPriceAge: Number(t.maxPriceAge),
    };
  };
  const setThresholds = (t: Thresholds) => send(DEPLOYER, at("GuardianReceiver"), guardianReceiverAbi, "setThresholds", [t]);
  const creditPausedNow = () => read(at("PolarisCheckout"), polarisCheckoutAbi, "creditPaused") as readonly [boolean, number];
  /** What openPlan does right now, asked with eth_call: the error it reverts with. The guard is its first check. */
  const openPlanRevert = () => {
    const intent = { buyer: buyer.address, merchant: d.demo.merchant, principal: 1n, installments: 4, interval: 60n, orderId: "guard-probe", nonce: 0n, deadline: 0n };
    const permit = { value: 0n, deadline: 0n, v: 27, r: `0x${"11".repeat(32)}` as Hex, s: `0x${"22".repeat(32)}` as Hex };
    const data = encodeFunctionData({ abi: polarisCheckoutAbi, functionName: "openPlan", args: [intent, "0x", permit] });
    try {
      rpcSync(RPC, "eth_call", [{ from: RELAYER, to: at("PolarisCheckout"), data }, "latest"]);
      return null;
    } catch (e) {
      const raw = (e as { data?: unknown }).data;
      const revert = (typeof raw === "string" ? raw : (raw as { data?: string } | undefined)?.data) as Hex;
      const err = decodeErrorResult({ abi: polarisCheckoutAbi, data: revert });
      return { name: err.errorName, args: (err.args ?? []).map((a) => (typeof a === "bigint" ? Number(a) : a)) };
    }
  };
  const guardianConfig = (over: Partial<GuardianConfig> = {}): GuardianConfig =>
    guardianSchema.parse({ ...JSON.parse(fs.readFileSync(join(ROOT, "guardian", "config.local.json"), "utf8")), ...over });
  const guard = (over: Partial<GuardianConfig> = {}) => {
    const { record } = harness();
    const out = JSON.parse(guardianCron(newTestRuntime(null, { timeProvider: () => chainNowMs(RPC) }, guardianConfig(over)), cronAt()));
    return { out, record };
  };

  test("guardian: the first attestation is healthy, and GuardianReceiver decodes and re-evaluates exactly the bytes the workflow wrote", () => {
    const { out, record } = guard();
    expect(out).toMatchObject({ status: "written", why: "first", transition: "first", round: "1" });
    expect(out.verdict).toEqual({ creditPaused: false, reasons: 0, reasonNames: [] });
    expect(out.price).toMatchObject({ kind: "mock", description: "AUSD / USD (local mock, not Chainlink)", answer: "0.9998" });
    // The pool and the receiver were read at one block, by number.
    expect(record.blocks[0]).toMatch(/^0x[0-9a-f]+$/);
    expect(record.blocks[1]).toBe(record.blocks[0]!);
    expect(Number(BigInt(record.blocks[0]!))).toBe(Number(out.pool.block));

    // The contract's own decoder and evaluate, on the workflow's bytes.
    const w = record.writes[0]!;
    const { attestation } = decodeGuardianReport(w.body);
    const onChain = read(at("GuardianReceiver"), guardianReceiverAbi, "latestAttestation") as Attestation;
    expect({ ...onChain, reasons: Number(onChain.reasons) }).toEqual(attestation);
    expect(Number(read(at("GuardianReceiver"), guardianReceiverAbi, "evaluate", [attestation]))).toBe(guardianReasons(attestation, thresholdsNow()));
    expect(attestation.freeCash).toBe((read(at("PolarisLoanEngine"), polarisLoanEngineAbi, "poolState") as { freeCash: bigint }).freeCash);
    // The pool-health feed: free cash in dollars at the attested price, 8 decimals.
    const [round, answer, , updatedAt] = read(at("GuardianReceiver"), guardianReceiverAbi, "latestRoundData") as readonly [bigint, bigint, bigint, bigint, bigint];
    expect(round).toBe(1n);
    expect(answer).toBe((attestation.freeCash * attestation.price) / 1_000_000n);
    expect(updatedAt).toBe(attestation.observedAt);
    expect(creditPausedNow()).toEqual([false, 0]);
    expect(w.gasUsed).toBeLessThanOrEqual(w.gasLimit);
    track(record, "guardian, first attestation");

    // Nothing new inside the heartbeat: no second write.
    rpcSync(RPC, "evm_mine", []);
    const again = guard();
    expect(again.out).toMatchObject({ status: "unchanged", why: "unchanged", txHash: null });
    expect(again.record.writes).toHaveLength(0);
  });

  test("guardian: the owner raises the depeg threshold to $1.001 (for the demo); the next run pauses Pay in 4, and a healthy one resumes it", () => {
    const normal = thresholdsNow();
    setThresholds({ ...normal, minPrice: 100_100_000n });
    const paused = guard();
    expect(paused.out).toMatchObject({ status: "written", why: "verdict", transition: "paused", thresholds: { minPrice: "1.001" } });
    expect(paused.out.verdict).toEqual({ creditPaused: true, reasons: 1, reasonNames: ["depeg"] });
    expect(creditPausedNow()).toEqual([true, 1]);
    expect(openPlanRevert()).toEqual({ name: "CreditPausedByGuardian", args: [1] });
    // The feed answers 0 while the attestation paused credit.
    expect((read(at("GuardianReceiver"), guardianReceiverAbi, "latestRoundData") as readonly bigint[])[1]).toBe(0n);
    track(paused.record, "guardian, pause");

    setThresholds(normal);
    const resumed = guard();
    expect(resumed.out).toMatchObject({ status: "written", why: "verdict", transition: "resumed" });
    expect(creditPausedNow()).toEqual([false, 0]);
    // openPlan gets past the guard again (and fails on this probe's own empty signature instead).
    expect(openPlanRevert()?.name).not.toBe("CreditPausedByGuardian");
  });

  test("guardian: on the labelled local mock, a real depeg and then a stale round keep credit paused; the recovery resumes it", () => {
    const feed = at("MockAusdUsdFeed");
    send(DEPLOYER, feed, mockPriceFeedAbi, "setAnswer", [99_000_000n]);
    const depeg = guard();
    expect(depeg.out).toMatchObject({ transition: "paused", verdict: { reasons: 1, reasonNames: ["depeg"] }, price: { answer: "0.99" } });

    // The peg is back, but the round is 2 h 1 s old: a stale price is no price.
    send(DEPLOYER, feed, mockPriceFeedAbi, "setRound", [99_980_000n, BigInt(Math.floor(chainNowMs(RPC) / 1000) - 7_201)]);
    const stale = guard();
    expect(stale.out).toMatchObject({ transition: "reasons-changed", verdict: { creditPaused: true, reasonNames: ["stale_price"] } });
    expect(creditPausedNow()).toEqual([true, 8]);

    send(DEPLOYER, feed, mockPriceFeedAbi, "setAnswer", [99_980_000n]);
    const back = guard();
    expect(back.out).toMatchObject({ transition: "resumed", verdict: { creditPaused: false, reasons: 0 } });
    expect(creditPausedNow()).toEqual([false, 0]);
  });

  test("pay in 4 opens on that line, from the buyer's two signatures", async () => {
    const token = at("Stablecoin");
    const engine = at("PolarisLoanEngine");
    const checkout = at("PolarisCheckout");
    send(DEPLOYER, token, mockAUSDAbi, "mint", [buyer.address, 400_000_000n]);
    const now = BigInt(Math.floor(chainNowMs(RPC) / 1000));
    const principal = 200_000_000n;
    const quote = read(checkout, polarisCheckoutAbi, "quotePlan", [buyer.address, principal, 4, 60n]) as { permitValue: bigint; withinLimit: boolean };
    expect(quote.withinLimit).toBe(true);
    const intent = {
      buyer: buyer.address,
      merchant: d.demo.merchant,
      principal,
      installments: 4,
      interval: 60n,
      orderId: `cre-e2e-${now}`,
      nonce: read(checkout, polarisCheckoutAbi, "nonces", [buyer.address]) as bigint,
      deadline: now + 1800n,
    };
    const dom = (n: string) => ({ ...d.eip712[n]!.domain }) as never;
    const planSig = await buyer.signTypedData({ domain: dom("PolarisCheckout"), types: { PlanIntent: d.eip712.PolarisCheckout!.types.PlanIntent! }, primaryType: "PlanIntent", message: intent });
    const permitMsg = {
      owner: buyer.address,
      spender: engine,
      value: quote.permitValue,
      nonce: read(token, mockAUSDAbi, "nonces", [buyer.address]) as bigint,
      deadline: now + 1800n,
    };
    const permitSig = parseSignature(
      await buyer.signTypedData({ domain: dom("Stablecoin"), types: { Permit: d.eip712.Stablecoin!.types.Permit! }, primaryType: "Permit", message: permitMsg }),
    );
    const receipt = send(RELAYER, checkout, polarisCheckoutAbi, "openPlan", [
      intent,
      planSig,
      { value: permitMsg.value, deadline: permitMsg.deadline, v: Number(permitSig.v), r: permitSig.r, s: permitSig.s },
    ]);
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: polarisCheckoutAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "PlanOpened") loanId = (ev.args as { loanId: bigint }).loanId;
      } catch {
        // another contract's event
      }
    }
    expect(loanId).toBeGreaterThan(0n);
  });

  /** The plan as the indexer holds it: next attempt at the next instalment's due time (no shortfall yet). */
  const indexedPlan = () => {
    const engine = at("PolarisLoanEngine");
    const loan = read(engine, polarisLoanEngineAbi, "getLoan", [loanId]) as { installmentsPaid: number; status: number };
    const dueAt = read(engine, polarisLoanEngineAbi, "installmentDueAt", [loanId, loan.installmentsPaid]) as bigint;
    const status = ["ACTIVE", "REPAID", "LIQUIDATED"][loan.status]!;
    return { id: loanId.toString(), loanId: loanId.toString(), status, nextAttemptAt: Number(dueAt), liquidatableAt: null };
  };

  test("collections, candidates from the indexer: nothing before the due time, instalment 1 when due, the webhook signed", () => {
    const { record, callbacks } = harness(() => ({ Plan: [indexedPlan()], Subscription: [] }));
    const withIndexer = collectionsConfig({
      candidates: { indexerUrl: INDEXER_URL, indexerQuery: null, indexerLimit: 100, recentWindow: 50, sweepWindow: 0, chainBackoff: null },
    });
    const early = collect(withIndexer);
    expect(early).toMatchObject({ status: "idle", source: "indexer", checked: 0 }); // the indexer proposed nothing yet

    travel(RPC, 61);
    const out = collect(withIndexer);
    expect(out.source).toBe("indexer");
    expect(out.note).toBeNull();
    expect(out.status).toBe("written");
    expect(out.executed).toBe(1);
    const loan = read(at("PolarisLoanEngine"), polarisLoanEngineAbi, "getLoan", [loanId]) as { installmentsPaid: number };
    expect(loan.installmentsPaid).toBe(1);
    const [collected] = lastEvents(callbacks);
    expect(collected).toMatchObject({ type: "installment.collected", loanId: loanId.toString() });
    expect(BigInt(collected!.amount!)).toBeGreaterThan(50_000_000n);
    const w = record.writes.at(-1)!;
    expect(w.gasUsed).toBeLessThanOrEqual(w.gasLimit);
    track(record, "collections, 1 instalment");
  });

test("instant retry: a revoked allowance is dunned; the buyer re-signs through PolarisCheckout.reauthorize; the log-triggered run collects in the next block", async () => {
    const token = at("Stablecoin");
    const engine = at("PolarisLoanEngine");
    const checkout = at("PolarisCheckout");
    const { callbacks, record } = harness();
    const config = collectionsConfig();
    expect(config.retry).toEqual({ checkout, confidence: "FINALIZED" }); // configure filled it from the deployment

    // The buyer's allowance is gone when instalment 2 falls due: the cron dunns them.
    send(buyer.address, token, mockAUSDAbi, "approve", [engine, 0n]);
    travel(RPC, 60);
    const dunned = collect(config);
    expect(dunned.skipped).toBe(1);
    expect(lastEvents(callbacks)).toEqual([expect.objectContaining({ type: "installment.failed", loanId: loanId.toString(), reason: "allowance_lost" })]);
    track(record, "collections, 1 skipped (allowance)");
    // Without the retry, the next cron run after this rung's window would hold them for the next rung, 6 hours on.
    const later = Math.floor(chainNowMs(RPC) / 1000) + config.candidates.chainBackoff!.windowSeconds + 5;
    const waiting = JSON.parse(
      onCron(newTestRuntime(secrets, { timeProvider: () => later * 1000 }, config), { scheduledExecutionTime: { seconds: BigInt(later), nanos: 0 } } as unknown as CronPayload),
    );
    // (Read before toMatchObject: bun 1.4 writes its asymmetric matchers into the object it matched.)
    const nextAttemptAt = Number(waiting.heldBack[0]?.nextAttemptAt);
    expect(waiting).toMatchObject({ status: "idle", heldBack: [{ action: "collect", id: loanId.toString() }] });
    expect(nextAttemptAt - later).toBeGreaterThan(5 * 3600);

    // The buyer signs a fresh permit for everything they owe; the relayer submits it.
    const now = BigInt(Math.floor(chainNowMs(RPC) / 1000));
    const owed = read(engine, polarisLoanEngineAbi, "activeDebtOf", [buyer.address]) as bigint;
    const permitMsg = { owner: buyer.address, spender: engine, value: owed, nonce: read(token, mockAUSDAbi, "nonces", [buyer.address]) as bigint, deadline: now + 1800n };
    const sig = parseSignature(
      await buyer.signTypedData({
        domain: { ...d.eip712.Stablecoin!.domain } as never,
        types: { Permit: d.eip712.Stablecoin!.types.Permit! },
        primaryType: "Permit",
        message: permitMsg,
      }),
    );
    const reauth = send(RELAYER, checkout, polarisCheckoutAbi, "reauthorize", [
      buyer.address,
      { value: owed, deadline: permitMsg.deadline, v: Number(sig.v), r: sig.r, s: sig.s },
    ]);
    // The log the trigger fires on: Reauthorized, after the token's own Approval (so --evm-event-index 1).
    const index = reauth.logs.findIndex((l) => l.address.toLowerCase() === checkout.toLowerCase() && l.topics[0] === REAUTHORIZED_TOPIC);
    expect(index).toBe(1);

    const out = JSON.parse(onReauthorized(newTestRuntime(secrets, { timeProvider: () => chainNowMs(RPC) }, config), logTriggerPayload(reauth, index)));
    expect(out).toMatchObject({
      status: "written",
      source: "event",
      trigger: { kind: "log", event: "Reauthorized", buyer: buyer.address, txHash: reauth.transactionHash },
      tasks: [{ action: "collect", id: loanId.toString() }],
      executed: 1,
      skipped: 0,
    });
    const loan = read(engine, polarisLoanEngineAbi, "getLoan", [loanId]) as { installmentsPaid: number };
    expect(loan.installmentsPaid).toBe(2);
    expect(lastEvents(callbacks)).toEqual([expect.objectContaining({ type: "installment.collected", loanId: loanId.toString() })]);
    // Seconds, not hours: the collection is the block after the re-sign.
    const collected = rpcSync<{ blockNumber: Hex }>(RPC, "eth_getTransactionReceipt", [out.txHash]);
    expect(Number(BigInt(collected.blockNumber) - BigInt(reauth.blockNumber))).toBe(1);
    expect(blockTime(RPC, collected.blockNumber) - blockTime(RPC, reauth.blockNumber)).toBeLessThanOrEqual(2);
    track(record, "retry (log trigger), 1 instalment");
  });

  test("dunning: a revoked allowance asks the buyer to sign again; an empty balance asks them to top up", () => {
    const { callbacks, record } = harness();
    const token = at("Stablecoin");
    const engine = at("PolarisLoanEngine");
    send(buyer.address, token, mockAUSDAbi, "approve", [engine, 0n]);
    travel(RPC, 60);
    const first = collect(collectionsConfig());
    expect(first.source).toBe("chain");
    expect(first.skipped).toBe(1);
    expect(lastEvents(callbacks)).toEqual([
      expect.objectContaining({ type: "installment.failed", loanId: loanId.toString(), reason: "allowance_lost", error: "InsufficientAllowance" }),
    ]);

    send(buyer.address, token, mockAUSDAbi, "approve", [engine, maxUint256]);
    const held = read(token, mockAUSDAbi, "balanceOf", [buyer.address]) as bigint;
    send(buyer.address, token, mockAUSDAbi, "transfer", [SINK, held]);
    const second = collect(collectionsConfig());
    expect(lastEvents(callbacks)).toEqual([
      expect.objectContaining({ type: "installment.failed", loanId: loanId.toString(), reason: "insufficient_funds", error: "InsufficientBalance", have: "0" }),
    ]);
    expect(second.skipped).toBe(1);
    track(record, "collections, 1 skipped (dunning)");

    // Past the rung's window and before grace, the chain fallback keeps the ladder: no attempt, no gas.
    const ladder = collectionsConfig().candidates.chainBackoff!;
    travel(RPC, ladder.windowSeconds + 5);
    const third = collect(collectionsConfig());
    expect(third).toMatchObject({ source: "chain", status: "idle", txHash: null });
    expect(third.heldBack).toEqual([{ action: "collect", id: loanId.toString(), nextAttemptAt: expect.any(Number) }]);
    expect(third.heldBack[0].nextAttemptAt).toBeGreaterThan(Math.floor(chainNowMs(RPC) / 1000));
    // Without the ladder the same run would have paid for another failing collection.
    expect(collect(collectionsConfig({ candidates: { ...collectionsConfig().candidates, chainBackoff: null } })).skipped).toBe(1);
  });

  test("past grace, a plan that cannot be collected is liquidated in the same report", () => {
    const { callbacks, record } = harness();
    travel(RPC, 130);
    const out = collect(collectionsConfig());
    expect(out.tasks).toEqual([
      { action: "collect", id: loanId.toString() },
      { action: "liquidate", id: loanId.toString() },
    ]);
    const events = lastEvents(callbacks);
    expect(events).toContainEqual(expect.objectContaining({ type: "installment.failed", reason: "insufficient_funds" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "plan.liquidated", loanId: loanId.toString() }));
    const loan = read(at("PolarisLoanEngine"), polarisLoanEngineAbi, "getLoan", [loanId]) as { status: number };
    expect(loan.status).toBe(2); // Liquidated
    for (const w of record.writes) expect(w.gasUsed).toBeLessThanOrEqual(w.gasLimit);
    track(record, "collections, skip + liquidation");
    // Nothing left to do: the next run is idle.
    expect(collect(collectionsConfig()).status).toBe("idle");
  });

  test("a report with an action the receiver does not know is skipped, and the rest of it still runs", () => {
    const { encodeRawReport } = requireModule("@polarispay/contracts/lib/cre") as { encodeRawReport(p: { body: string }): Hex };
    const body = encodeCollectionsReport([{ action: 9 as never, id: 1n }]);
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "report", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes" }, { type: "bytes" }, { type: "bytes[]" }], outputs: [] }],
      functionName: "report",
      args: [at("CollectionsReceiver"), encodeRawReport({ body }), "0x", []],
    });
    const receipt = sendTx(RPC, { from: DEPLOYER, to: SIM_FORWARDER, data });
    const skipped = receipt.logs
      .filter((l) => l.address.toLowerCase() === at("CollectionsReceiver").toLowerCase())
      .map((l) => decodeEventLog({ abi: collectionsReceiverAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }))
      .find((e) => e.eventName === "TaskSkipped");
    expect(skipped).toBeDefined();
    const reason = classifySkip((skipped!.args as { reason: Hex }).reason);
    expect(reason).toMatchObject({ class: "other", error: "UnknownAction" });
    rpcSync(RPC, "evm_mine", []);
  });

  test("guardian after a real loss: the shortfall is bad debt, read from the pool at once; the owner acknowledges it, and only new losses count", () => {
    const pool = read(at("PolarisLoanEngine"), polarisLoanEngineAbi, "poolState") as { badDebt: bigint; totalOriginated: bigint };
    expect(pool.badDebt).toBeGreaterThan((pool.totalOriginated * 500n) / 10_000n);
    const normal = thresholdsNow();
    // This local pool has lent less than the $10,000 floor: one loss there is not a portfolio, and pauses nobody.
    expect(pool.totalOriginated).toBeLessThan(normal.minOriginated);
    expect(creditPausedNow()).toEqual([false, 0]);
    // Without the floor it pauses Pay in 4 at once: GuardianReceiver reads bad debt from the pool, no report needed.
    setThresholds({ ...normal, minOriginated: 0n });
    expect(creditPausedNow()).toEqual([true, 4]);
    const { out, record } = guard();
    expect(out).toMatchObject({ status: "written", why: "verdict", transition: "paused" });
    expect(out.verdict.reasonNames).toEqual(["bad_debt"]);
    expect(out.pool.badDebt).toBe(pool.badDebt.toString());
    expect(creditPausedNow()).toEqual([true, 4]);
    track(record, "guardian, bad-debt pause");

    // Bad debt never falls, so no later report lifts it: the owner acknowledges the loss.
    send(DEPLOYER, at("GuardianReceiver"), guardianReceiverAbi, "acknowledgeBadDebt", []);
    expect(creditPausedNow()).toEqual([false, 0]);
    const status = read(at("GuardianReceiver"), guardianReceiverAbi, "creditStatus") as { paused: boolean; attestedPaused: boolean; badDebtAcknowledged: bigint };
    expect(status).toMatchObject({ paused: false, attestedPaused: true, badDebtAcknowledged: pool.badDebt });
    rpcSync(RPC, "evm_mine", []);
    const after = guard();
    expect(after.out).toMatchObject({ status: "written", transition: "resumed", pool: { badDebtAcknowledged: pool.badDebt.toString() } });
    expect(after.out.verdict).toEqual({ creditPaused: false, reasons: 0, reasonNames: [] });
    setThresholds(normal);
  });
});
