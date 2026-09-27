/**
 * `polaris-collections`: the Pay in 4 collections engine, on a cron.
 *
 *   1. Candidates. The Envio indexer proposes the plans and subscriptions
 *      whose due time has passed (HTTP, identical consensus); without an
 *      indexer, or when it fails, the chain does (`loanCount`,
 *      `subscriptionCount` and a bounded window of ids).
 *   2. The chain disposes. `CollectionsReceiver.checkTasks` at the last
 *      finalized block says which candidates are actionable: one EVM read per
 *      72 tasks, well under CRE's 5 KB read cap.
 *   3. One signed report, `abi.encode(uint8 1, (uint8 action, uint256 id)[])`,
 *      written through the forwarder with a gas limit sized from an estimate
 *      (Monad bills the limit).
 *   4. The receipt is read back. `TaskSkipped` reasons become
 *      `installment.failed` events (reauthorize vs top up) for the dunning
 *      ladder, posted signed to the Polaris API.
 *
 * A configured indexer that fails is never silent: the run reads candidates
 * from the chain (which has no dunning backoff), says so in `indexerError`,
 * and posts the callback even when nothing else happened, so the API can
 * raise it instead of the fallback quietly becoming the normal path.
 *
 * The run returns a JSON summary; the chain events are the record.
 */

import { type CronPayload, cre, consensusIdenticalAggregation, type HTTPSendRequester, type Runtime } from "@chainlink/cre-sdk";
import { collectionsReceiverAbi } from "@polarispay/contracts/abi";
import { type Address, parseAbi } from "viem";
import { z } from "zod";
import { base64Utf8 } from "../shared/callback.ts";
import { address, callbackSchema, chainSelectorName, gasSchema } from "../shared/config.ts";
import {
  deliveredTo,
  estimateOnReport,
  type EVMClient,
  evmClientFor,
  gasLimitFor,
  nowSeconds,
  readContract,
  readReceipt,
  signReport,
  submitReport,
} from "../shared/evm.ts";
import { optionalSecret, postSignedCallback } from "../shared/http.ts";
import {
  candidatesRequestBody,
  DUE_CANDIDATES_QUERY,
  type IndexerCandidates,
  packCandidates,
  parseIndexerCandidates,
  unpackCandidates,
} from "./candidates.ts";
import { type CollectionsEvent, eventsFor, outcomeFromReceipt, summarize } from "./outcomes.ts";
import {
  ACTION,
  chainWindow,
  chunk,
  encodeCollectionsReport,
  MAX_CHECK_BATCH,
  planTasks,
  type Ready,
  type Task,
} from "./tasks.ts";

export const configSchema = z.object({
  /** Six-field cron (seconds first), UTC. CRE fires no faster than every 30 s. */
  schedule: z.string().min(1),
  chainSelectorName,
  receiver: address("CollectionsReceiver"),
  loanEngine: address("PolarisLoanEngine"),
  payments: address("PolarisPayments"),
  /** The forwarder the receiver trusts; the gas estimate calls `onReport` as it. */
  forwarder: address("forwarder"),
  candidates: z.object({
    /** Envio HyperIndex GraphQL endpoint, or null to read candidates from the chain. */
    indexerUrl: z.string().url().nullable(),
    /** Overrides DUE_CANDIDATES_QUERY for an indexer with another schema. */
    indexerQuery: z.string().min(1).nullable(),
    /** Most candidates of each kind to take from the indexer. */
    indexerLimit: z.number().int().min(1).max(500),
    /** Chain mode: the newest ids of each kind checked every run. */
    recentWindow: z.number().int().min(1).max(500),
    /** Chain mode: older ids checked per run, rotating so each is revisited. */
    sweepWindow: z.number().int().min(0).max(500),
  }),
  /** Liquidate plans past grace when their collection fails. */
  liquidate: z.boolean(),
  /** Tasks per report, bounded by gas: a collection costs about 150k. */
  maxTasksPerReport: z.number().int().min(1).max(60),
  /** Tasks per `checkTasks` read. */
  checkBatch: z.number().int().min(1).max(MAX_CHECK_BATCH),
  gas: gasSchema,
  callback: callbackSchema,
});
export type CollectionsConfig = z.infer<typeof configSchema>;

/** CRE's EVM read quota per execution (docs/research/cre.md §8). */
export const EVM_READ_LIMIT = 15;

const COUNTS_ABI = parseAbi([
  "function loanCount() view returns (uint256)",
  "function subscriptionCount() view returns (uint256)",
]);

export interface CollectionsResult {
  status: "idle" | "written" | "dry-run";
  source: "indexer" | "chain";
  /** Why a configured indexer was not used this run, or null. */
  indexerError: string | null;
  note: string | null;
  checked: number;
  tasks: Array<{ action: string; id: string }>;
  txHash: string | null;
  gasLimit: string | null;
  executed: number;
  skipped: number;
  events: number;
  callbackStatus: number | null;
}

interface CallbackTally {
  tasks: number;
  executed: number;
  skipped: number;
}

/** Counts every EVM read so a run never asks CRE for more than its quota. */
class ReadBudget {
  used = 0;
  constructor(private readonly limit: number) {}
  take(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }
  get left(): number {
    return this.limit - this.used;
  }
}

/** Node mode: ask the indexer, return the ids packed as one string (or ERR:…). */
function askIndexer(req: HTTPSendRequester, url: string, body: string): string {
  try {
    const res = req
      .sendRequest({
        url,
        method: "POST",
        body: base64Utf8(body),
        multiHeaders: { "content-type": { values: ["application/json"] } },
        timeout: "10s",
        cacheSettings: { store: true, maxAge: "30s" },
      })
      .result();
    if (res.statusCode !== 200) return `ERR:HTTP ${res.statusCode}`;
    return packCandidates(parseIndexerCandidates(JSON.parse(new TextDecoder().decode(res.body))));
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }
}

function fromIndexer(runtime: Runtime<CollectionsConfig>, now: number): IndexerCandidates | { error: string } {
  const c = runtime.config.candidates;
  if (!c.indexerUrl) return { error: "no indexer configured" };
  const body = candidatesRequestBody(c.indexerQuery ?? DUE_CANDIDATES_QUERY, now, c.indexerLimit);
  const packed = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, askIndexer, consensusIdenticalAggregation<string>().withDefault("ERR:no consensus"))(c.indexerUrl, body)
    .result();
  return unpackCandidates(packed);
}

function fromChain(runtime: Runtime<CollectionsConfig>, evm: EVMClient, budget: ReadBudget, tick: bigint): IndexerCandidates {
  const cfg = runtime.config;
  if (!budget.take(2)) throw new Error("EVM read budget exhausted before counting");
  const loans = readContract(runtime, evm, { address: cfg.loanEngine, abi: COUNTS_ABI, functionName: "loanCount" }) as bigint;
  const subs = readContract(runtime, evm, { address: cfg.payments, abi: COUNTS_ABI, functionName: "subscriptionCount" }) as bigint;
  const { recentWindow, sweepWindow } = cfg.candidates;
  return {
    loans: chainWindow(loans, recentWindow, sweepWindow, tick),
    subscriptions: chainWindow(subs, recentWindow, sweepWindow, tick),
  };
}

/** `checkTasks` in batches; stops (and says so) when the read budget runs out. */
function readyAmong(
  runtime: Runtime<CollectionsConfig>,
  evm: EVMClient,
  budget: ReadBudget,
  tasks: Task[],
  reserve: number,
): { ready: Task[]; checked: number } {
  const ready: Task[] = [];
  let checked = 0;
  for (const batch of chunk(tasks, runtime.config.checkBatch)) {
    if (budget.left <= reserve || !budget.take()) break;
    const flags = readContract(runtime, evm, {
      address: runtime.config.receiver,
      abi: collectionsReceiverAbi,
      functionName: "checkTasks",
      args: [batch.map((t) => ({ action: t.action, id: t.id }))],
    }) as readonly boolean[];
    batch.forEach((t, i) => {
      if (flags[i]) ready.push(t);
    });
    checked += batch.length;
  }
  return { ready, checked };
}

export function onCron(runtime: Runtime<CollectionsConfig>, payload: CronPayload): string {
  const cfg = runtime.config;
  const evm = evmClientFor(cfg.chainSelectorName);
  const budget = new ReadBudget(EVM_READ_LIMIT);
  const now = nowSeconds(runtime);
  // The same on every node: the time this run was scheduled for, not a clock read.
  const tick = payload.scheduledExecutionTime?.seconds ?? BigInt(now);
  // Two reads kept back for the write: the gas estimate and the receipt.
  const RESERVE = 2;

  // 1. Candidates: the indexer proposes, else the chain.
  let source: CollectionsResult["source"] = "indexer";
  let note: string | null = null;
  let indexerError: string | null = null;
  let candidates: IndexerCandidates;
  const indexed = cfg.candidates.indexerUrl ? fromIndexer(runtime, now) : null;
  if (indexed && !("error" in indexed)) {
    candidates = indexed;
  } else {
    if (indexed && "error" in indexed) {
      indexerError = indexed.error;
      note = `indexer unavailable (${indexed.error}); read candidates from the chain, which has no dunning backoff`;
      runtime.log(note);
    }
    source = "chain";
    candidates = fromChain(runtime, evm, budget, tick);
  }

  // 2. The chain disposes: what is actionable at the last finalized block.
  const first = readyAmong(
    runtime,
    evm,
    budget,
    [
      ...candidates.loans.map((id) => ({ action: ACTION.COLLECT_INSTALLMENT, id }) as Task),
      ...candidates.subscriptions.map((id) => ({ action: ACTION.CHARGE_SUBSCRIPTION, id }) as Task),
    ],
    RESERVE,
  );
  const ready: Ready = {
    collect: first.ready.filter((t) => t.action === ACTION.COLLECT_INSTALLMENT).map((t) => t.id),
    charge: first.ready.filter((t) => t.action === ACTION.CHARGE_SUBSCRIPTION).map((t) => t.id),
    liquidate: [],
  };
  let checked = first.checked;
  // Only a due loan can be past grace, so liquidation is checked on those alone.
  if (cfg.liquidate && ready.collect.length > 0) {
    const second = readyAmong(
      runtime,
      evm,
      budget,
      ready.collect.map((id) => ({ action: ACTION.LIQUIDATE, id }) as Task),
      RESERVE,
    );
    ready.liquidate = second.ready.map((t) => t.id);
    checked += second.checked;
  }
  const total = candidates.loans.length + candidates.subscriptions.length;
  if (first.checked < total) {
    const more = `checked ${first.checked} of ${total} candidates inside the ${EVM_READ_LIMIT}-read quota; the rest wait for the next run`;
    note = note ? `${note}; ${more}` : more;
    runtime.log(more);
  }

  const tasks = planTasks(ready, cfg.maxTasksPerReport);
  const base: CollectionsResult = {
    status: "idle",
    source,
    indexerError,
    note,
    checked,
    tasks: tasks.map((t) => ({ action: ["", "collect", "charge", "liquidate"][t.action]!, id: t.id.toString() })),
    txHash: null,
    gasLimit: null,
    executed: 0,
    skipped: 0,
    events: 0,
    callbackStatus: null,
  };
  /** The signed run callback: whenever a task moved or failed, and whenever the indexer failed. */
  const callBack = (result: CollectionsResult, run: { id: string; txHash: string | null; tally: CallbackTally; events: CollectionsEvent[] }) => {
    if (!cfg.callback || (run.events.length === 0 && indexerError === null)) return;
    const secret = optionalSecret(runtime, cfg.callback.secretId);
    if (!secret) {
      runtime.log(`callback skipped: secret ${cfg.callback.secretId} is not set`);
      return;
    }
    result.callbackStatus = postSignedCallback(runtime, {
      url: cfg.callback.url,
      secret,
      payload: {
        id: run.id,
        type: "collections.run",
        createdAt: now,
        chain: cfg.chainSelectorName,
        receiver: cfg.receiver,
        txHash: run.txHash,
        candidates: { source, indexerError },
        tally: run.tally,
        events: run.events,
      },
    });
    runtime.log(`callback ${cfg.callback.url} answered ${result.callbackStatus}`);
  };

  if (tasks.length === 0) {
    runtime.log(`nothing due among ${checked} checks (${source})`);
    // No transaction to key on: the scheduled tick is the same on every node.
    callBack(base, { id: `collections:${tick}`, txHash: null, tally: { tasks: 0, executed: 0, skipped: 0 }, events: [] });
    return JSON.stringify(base);
  }

  // 3. One report, gas sized from an estimate.
  const report = signReport(runtime, encodeCollectionsReport(tasks));
  budget.take();
  const estimate = estimateOnReport(runtime, evm, { forwarder: cfg.forwarder, receiver: cfg.receiver, report });
  const gasLimit = gasLimitFor(estimate, cfg.gas);
  const write = submitReport(runtime, evm, { receiver: cfg.receiver, report, gasLimit });
  runtime.log(`wrote ${tasks.length} tasks, gas limit ${gasLimit} (estimate ${estimate}), tx ${write.txHash}`);
  const result: CollectionsResult = { ...base, status: "written", txHash: write.txHash, gasLimit: gasLimit.toString() };
  if (!write.broadcast) return JSON.stringify({ ...result, status: "dry-run" });

  // 4. Read back what happened; simulation reports a reverted receiver as success.
  budget.take();
  const receipt = readReceipt(runtime, evm, write.txHash);
  if (deliveredTo(receipt, cfg.receiver) === false) {
    throw new Error(`CollectionsReceiver reverted the report in ${write.txHash} (the forwarder recorded result=false)`);
  }
  const outcome = outcomeFromReceipt(receipt, cfg.receiver as Address);
  runtime.log(summarize(outcome));
  const events = eventsFor(write.txHash, outcome);
  result.executed = outcome.executed.length;
  result.skipped = outcome.skipped.length;
  result.events = events.length;

  callBack(result, {
    id: write.txHash,
    txHash: write.txHash,
    tally: { tasks: tasks.length, executed: outcome.executed.length, skipped: outcome.skipped.length },
    events,
  });
  return JSON.stringify(result);
}

export const initWorkflow = (config: CollectionsConfig) => [
  cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron),
];
