/**
 * The collections handler under the CRE SDK's test runtime: candidates in,
 * one report out, failures turned into dunning events. The EVM and HTTP
 * capabilities are the SDK's own mocks (@chainlink/cre-sdk/test).
 */

import { expect } from "bun:test";
import { cre, type CronPayload } from "@chainlink/cre-sdk";
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { collectionsReceiverAbi, polarisLoanEngineAbi } from "@polarispay/contracts/abi";
import { type Address, encodeErrorResult, type Hex, parseAbi } from "viem";
import { verifyCallback } from "../src/shared/callback.ts";
import { DUE_CANDIDATES_QUERY } from "../src/collections/candidates.ts";
import { ACTION, decodeCollectionsReport, type Task } from "../src/collections/tasks.ts";
import { type CollectionsConfig, configSchema, onCron } from "../src/collections/workflow.ts";
import { b64, eventLog, fakeTxHash, hexOf, receiptJson, type TestLog } from "./helpers/evm.ts";
import { type CreRequestLike, toSent } from "./helpers/fixtures-http.ts";
import { answerHasura } from "./helpers/hasura.ts";

const RECEIVER = "0x00000000000000000000000000000000000c0113" as Address;
const ENGINE = "0x0000000000000000000000000000000000e61e00" as Address;
const PAYMENTS = "0x0000000000000000000000000000000000fa7e00" as Address;
const FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as Address;
const SELECTOR = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-testnet"];
const NOW_MS = Date.UTC(2026, 8, 26, 12, 0, 0);
const SECRET = "test-callback-secret";

const baseConfig = (over: Partial<CollectionsConfig> = {}): CollectionsConfig =>
  configSchema.parse({
    schedule: "0 * * * * *",
    chainSelectorName: "monad-testnet",
    receiver: RECEIVER,
    loanEngine: ENGINE,
    payments: PAYMENTS,
    forwarder: FORWARDER,
    candidates: { indexerUrl: null, indexerQuery: null, indexerLimit: 100, recentWindow: 150, sweepWindow: 60 },
    liquidate: true,
    maxTasksPerReport: 25,
    checkBatch: 72,
    gas: { overhead: "80000", headroomBps: 1500, min: "200000", max: "8000000" },
    callback: null,
    ...over,
  });

const cron = (seconds = BigInt(NOW_MS / 1000)): CronPayload =>
  ({ scheduledExecutionTime: { seconds, nanos: 0 } }) as unknown as CronPayload;

const RECEIVER_EVENTS = parseAbi([
  "event TaskExecuted(uint8 indexed action, uint256 indexed id, uint256 amount)",
  "event TaskSkipped(uint8 indexed action, uint256 indexed id, bytes reason)",
  "event CollectionsRun(uint256 tasks, uint256 executed, uint256 skipped)",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

interface Chain {
  loanCount: bigint;
  subscriptionCount: bigint;
  /** Which (action, id) checkTasks says are ready. */
  ready: (t: { action: number; id: bigint }) => boolean;
  /** What the receiver does with each written task. */
  outcome?: (t: Task) => { executed: bigint } | { skipped: Hex };
  delivered?: boolean;
  estimate?: bigint;
}

/** Wire the EVM mock to a small fake chain and record what the workflow did. */
function fakeChain(chain: Chain) {
  const evm = EvmMock.testInstance(SELECTOR);
  const seen = { checkCalls: 0, checked: [] as Array<{ action: number; id: bigint }>, reports: [] as Task[][], gasLimits: [] as bigint[], countReads: 0 };

  const engine = addContractMock(evm, { address: ENGINE, abi: polarisLoanEngineAbi });
  engine.loanCount = () => {
    seen.countReads++;
    return chain.loanCount;
  };
  const payments = addContractMock(evm, {
    address: PAYMENTS,
    abi: parseAbi(["function subscriptionCount() view returns (uint256)"]),
  });
  payments.subscriptionCount = () => {
    seen.countReads++;
    return chain.subscriptionCount;
  };
  const receiver = addContractMock(evm, { address: RECEIVER, abi: collectionsReceiverAbi });
  receiver.checkTasks = (tasks: unknown) => {
    seen.checkCalls++;
    const list = tasks as Array<{ action: number; id: bigint }>;
    seen.checked.push(...list);
    return list.map((t) => chain.ready(t));
  };
  evm.estimateGas = () => ({ gas: String(chain.estimate ?? 300_000n) });

  let lastLogs: TestLog[] = [];
  evm.writeReport = (req) => {
    const raw = hexOf(req.report!.rawReport);
    const body = `0x${raw.slice(2 + 109 * 2)}` as Hex;
    const { kind, tasks } = decodeCollectionsReport(body);
    expect(kind).toBe(1);
    seen.reports.push(tasks);
    seen.gasLimits.push(req.gasConfig!.gasLimit);
    const logs: TestLog[] = [];
    let executed = 0n;
    let skipped = 0n;
    for (const t of tasks) {
      const o = chain.outcome?.(t) ?? { executed: 0n };
      if ("executed" in o) {
        executed++;
        logs.push(eventLog(RECEIVER_EVENTS, "TaskExecuted", RECEIVER, { action: t.action, id: t.id, amount: o.executed }));
      } else {
        skipped++;
        logs.push(eventLog(RECEIVER_EVENTS, "TaskSkipped", RECEIVER, { action: t.action, id: t.id, reason: o.skipped }));
      }
    }
    logs.push(eventLog(RECEIVER_EVENTS, "CollectionsRun", RECEIVER, { tasks: BigInt(tasks.length), executed, skipped }));
    logs.push(
      eventLog(RECEIVER_EVENTS, "ReportProcessed", FORWARDER, {
        receiver: RECEIVER,
        workflowExecutionId: fakeTxHash("exec"),
        reportId: "0x0001",
        result: chain.delivered ?? true,
      }),
    );
    lastLogs = chain.delivered === false ? logs.slice(-1) : logs;
    return { txStatus: "TX_STATUS_SUCCESS", txHash: b64(fakeTxHash(`tx${seen.reports.length}`)) };
  };
  evm.getTransactionReceipt = () => receiptJson(lastLogs);
  return seen;
}

function httpRecorder(answer: (url: string, body: string | undefined) => { status: number; json?: unknown }) {
  const http = HttpActionsMock.testInstance();
  const sent: ReturnType<typeof toSent>[] = [];
  http.sendRequest = (input) => {
    const s = toSent(input as unknown as CreRequestLike);
    sent.push(s);
    const a = answer(s.url, s.body);
    return { statusCode: a.status, body: b64(`0x${Buffer.from(JSON.stringify(a.json ?? {})).toString("hex")}`) };
  };
  return sent;
}

const run = (config: CollectionsConfig, secrets?: Map<string, Map<string, string>>, payload = cron()) => {
  const runtime = newTestRuntime(secrets ?? null, { timeProvider: () => NOW_MS }, config);
  return JSON.parse(onCron(runtime, payload));
};

const loanErr = (name: string, args: readonly unknown[] = []) =>
  encodeErrorResult({ abi: polarisLoanEngineAbi, errorName: name as never, args: args as never });

test("nothing due: reads the counts, checks every candidate, writes nothing", () => {
  const seen = fakeChain({ loanCount: 3n, subscriptionCount: 2n, ready: () => false });
  const out = run(baseConfig());
  expect(out.status).toBe("idle");
  expect(out.source).toBe("chain");
  expect(seen.countReads).toBe(2);
  expect(seen.reports).toHaveLength(0);
  // Three loans to collect and two subscriptions to charge; liquidation is only checked on due loans.
  expect(seen.checked.map((t) => `${t.action}:${t.id}`).sort()).toEqual(["1:1", "1:2", "1:3", "2:1", "2:2"]);
});

test("writes one report: each due loan's collection, then its liquidation if past grace, then charges", () => {
  const seen = fakeChain({
    loanCount: 5n,
    subscriptionCount: 2n,
    ready: (t) =>
      (t.action === ACTION.COLLECT_INSTALLMENT && (t.id === 2n || t.id === 4n)) ||
      (t.action === ACTION.LIQUIDATE && t.id === 4n) ||
      (t.action === ACTION.CHARGE_SUBSCRIPTION && t.id === 1n),
    outcome: () => ({ executed: 50_383_562n }),
    estimate: 400_000n,
  });
  const out = run(baseConfig());
  expect(out.status).toBe("written");
  expect(seen.reports).toHaveLength(1);
  expect(seen.reports[0]).toEqual([
    { action: ACTION.COLLECT_INSTALLMENT, id: 2n },
    { action: ACTION.COLLECT_INSTALLMENT, id: 4n },
    { action: ACTION.LIQUIDATE, id: 4n },
    { action: ACTION.CHARGE_SUBSCRIPTION, id: 1n },
  ]);
  // Monad bills the limit: (estimate + overhead) + 15%, not a blanket cap.
  expect(seen.gasLimits[0]).toBe(((400_000n + 80_000n) * 11_500n) / 10_000n);
  expect(out.executed).toBe(4);
});

test("turns shortfalls into installment.failed events that say what the buyer must do, signed for the API", () => {
  fakeChain({
    loanCount: 3n,
    subscriptionCount: 1n,
    ready: (t) => t.action !== ACTION.LIQUIDATE,
    outcome: (t) => {
      if (t.action === ACTION.CHARGE_SUBSCRIPTION) return { executed: 0n };
      if (t.id === 1n) return { skipped: loanErr("InsufficientAllowance", [10_000_000n, 50_383_562n]) };
      if (t.id === 2n) return { skipped: loanErr("InsufficientBalance", [1_000_000n, 50_383_562n]) };
      return { skipped: loanErr("NotDue") };
    },
  });
  const sent = httpRecorder(() => ({ status: 202 }));
  const secrets = new Map([["main", new Map([["POLARIS_CALLBACK_SECRET", SECRET]])]]);
  const out = run(baseConfig({ callback: { url: "https://api.polaris.test/v1/cre/collections", secretId: "POLARIS_CALLBACK_SECRET" } }), secrets);

  expect(out.callbackStatus).toBe(202);
  expect(sent).toHaveLength(1);
  const post = sent[0]!;
  expect(post.method).toBe("POST");
  expect(verifyCallback(SECRET, post.body!, post.headers["polaris-signature"], NOW_MS / 1000)).toEqual({ ok: true, timestamp: NOW_MS / 1000 });
  expect(post.headers["idempotency-key"]).toBe(out.txHash);
  const body = JSON.parse(post.body!);
  const failed = body.events.filter((e: { type: string }) => e.type === "installment.failed");
  expect(failed).toEqual([
    expect.objectContaining({ loanId: "1", reason: "reauthorize", error: "InsufficientAllowance", have: "10000000", need: "50383562" }),
    expect.objectContaining({ loanId: "2", reason: "top_up", error: "InsufficientBalance", have: "1000000", need: "50383562" }),
  ]);
  // A stale candidate (NotDue) is nobody's fault: no event for loan 3.
  expect(body.events.some((e: { loanId?: string }) => e.loanId === "3")).toBe(false);
  expect(body.events).toContainEqual(expect.objectContaining({ type: "subscription.charged", subscriptionId: "1" }));
});

test("the indexer proposes: its ids are checked on chain, and the chain counts are never read", () => {
  const seen = fakeChain({ loanCount: 999n, subscriptionCount: 999n, ready: (t) => t.id === 7n });
  const sent = httpRecorder((url, body) => {
    expect(url).toBe("https://indexer.polaris.test/v1/graphql");
    const q = JSON.parse(body!);
    expect(q.query).toBe(DUE_CANDIDATES_QUERY);
    expect(q.variables).toEqual({ now: NOW_MS / 1000, limit: 100 });
    return { status: 200, json: { data: { Loan: [{ loanId: "7" }, { loanId: 9 }], Subscription: [{ id: "10143-3" }] } } };
  });
  const out = run(
    baseConfig({
      candidates: { indexerUrl: "https://indexer.polaris.test/v1/graphql", indexerQuery: null, indexerLimit: 100, recentWindow: 150, sweepWindow: 60 },
    }),
  );
  expect(out.source).toBe("indexer");
  expect(seen.countReads).toBe(0);
  expect(sent[0]!.cached).toBe(true);
  expect(seen.checked.map((t) => `${t.action}:${t.id}`)).toEqual(["1:7", "1:9", "2:3", "3:7"]);
  expect(seen.reports[0]).toEqual([
    { action: ACTION.COLLECT_INSTALLMENT, id: 7n },
    { action: ACTION.LIQUIDATE, id: 7n },
  ]);
});

test("configured with the Polaris indexer, the default query is answered: no fall back, and a buyer in dunning is not retried early", () => {
  const now = NOW_MS / 1000;
  const seen = fakeChain({ loanCount: 999n, subscriptionCount: 999n, ready: (t) => t.action !== ACTION.LIQUIDATE });
  // The indexer's own schema and rows: loan 4 was short last run, so its next attempt is a rung up the ladder.
  const sent = httpRecorder((_url, body) => ({
    status: 200,
    json: answerHasura(body!, {
      Plan: [
        { id: "3", loanId: "3", status: "ACTIVE", nextAttemptAt: now - 60, liquidatableAt: null },
        { id: "4", loanId: "4", status: "ACTIVE", nextAttemptAt: now + 6 * 3600, liquidatableAt: now + 3 * 86_400 },
      ],
      Subscription: [{ id: "2", subId: "2", status: "ACTIVE", nextAttemptAt: now - 60 }],
    }),
  }));
  const out = run(
    baseConfig({
      candidates: { indexerUrl: "https://indexer.polaris.test/v1/graphql", indexerQuery: null, indexerLimit: 100, recentWindow: 150, sweepWindow: 60 },
    }),
  );
  expect(sent).toHaveLength(1);
  expect(out.source).toBe("indexer");
  expect(out.note).toBeNull();
  expect(seen.countReads).toBe(0);
  expect(seen.checked.map((t) => `${t.action}:${t.id}`)).toEqual(["1:3", "2:2", "3:3"]);
  expect(seen.reports[0]).toEqual([
    { action: ACTION.COLLECT_INSTALLMENT, id: 3n },
    { action: ACTION.CHARGE_SUBSCRIPTION, id: 2n },
  ]);
});

test("a failing indexer falls back to the chain instead of reading as 'nothing due'", () => {
  const seen = fakeChain({ loanCount: 2n, subscriptionCount: 0n, ready: (t) => t.action === ACTION.COLLECT_INSTALLMENT && t.id === 2n });
  httpRecorder(() => ({ status: 200, json: { errors: [{ message: "field 'Loan' not found" }] } }));
  const out = run(
    baseConfig({
      candidates: { indexerUrl: "https://indexer.polaris.test/v1/graphql", indexerQuery: null, indexerLimit: 100, recentWindow: 150, sweepWindow: 60 },
    }),
  );
  expect(out.source).toBe("chain");
  expect(out.note).toContain("field 'Loan' not found");
  expect(seen.countReads).toBe(2);
  expect(seen.reports[0]).toEqual([{ action: ACTION.COLLECT_INSTALLMENT, id: 2n }]);
});

test("stays inside CRE's 15-read quota however many candidates there are", () => {
  const seen = fakeChain({ loanCount: 5_000n, subscriptionCount: 5_000n, ready: () => false });
  const out = run(baseConfig({ candidates: { indexerUrl: null, indexerQuery: null, indexerLimit: 100, recentWindow: 500, sweepWindow: 500 } }));
  // 2 count reads + checkTasks reads, with 2 kept back for the write.
  expect(2 + seen.checkCalls).toBeLessThanOrEqual(15 - 2);
  expect(out.note).toContain("the rest wait for the next run");
});

test("a report the receiver reverted fails the run, even though simulation calls the write a success", () => {
  fakeChain({ loanCount: 1n, subscriptionCount: 0n, ready: (t) => t.action === ACTION.COLLECT_INSTALLMENT, delivered: false });
  expect(() => run(baseConfig())).toThrow(/reverted the report/);
});

test("caps a report at maxTasksPerReport without splitting a loan's collect-then-liquidate pair", () => {
  const seen = fakeChain({ loanCount: 10n, subscriptionCount: 0n, ready: () => true });
  run(baseConfig({ maxTasksPerReport: 5 }));
  expect(seen.reports[0]).toEqual([
    { action: 1, id: 1n },
    { action: 3, id: 1n },
    { action: 1, id: 2n },
    { action: 3, id: 2n },
  ]);
});
