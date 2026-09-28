/**
 * `polaris-collections`: the Pay in 4 collections engine, on a cron.
 *
 *   1. Candidates. The Envio indexer proposes the plans and subscriptions
 *      whose next attempt has come, on its dunning ladder (HTTP, identical
 *      consensus); without an indexer, or when it fails, the chain does
 *      (`loanCount`, `subscriptionCount` and a bounded window of ids), and
 *      the same ladder is kept from each task's due time (./backoff.ts).
 *   2. The chain disposes. `CollectionsReceiver.checkTasks` at the last
 *      finalized block says which candidates are actionable: one EVM read per
 *      72 tasks, well under CRE's 5 KB read cap.
 *   3. One signed report, `abi.encode(uint8 1, (uint8 action, uint256 id)[])`,
 *      written through the forwarder with a gas limit sized from an estimate
 *      (Monad bills the limit).
 *   4. The receipt is read back. `TaskSkipped` reasons become
 *      `installment.failed` events (allowance lost vs insufficient funds) for the dunning
 *      ladder, posted signed to the Polaris API.
 *
 * A configured indexer that fails is never silent: the run reads candidates
 * from the chain, says so in `indexerError`, and posts the callback even when
 * nothing else happened, so the API can raise it instead of the fallback
 * quietly becoming the normal path.
 *
 * A second trigger, the instant retry (./retry.ts): an EVM log trigger on
 * PolarisCheckout's `Reauthorized(buyer, …)`. A buyer dunned for a lost
 * allowance re-signs; the run reads `CollectionsReceiver.dueTasksFor(buyer)`
 * and writes the same report for just those tasks, seconds after the
 * re-sign instead of at the next rung of the dunning ladder. Steps 3 and 4
 * are shared (`deliver`), so both triggers write one format through one path.
 *
 * The run returns a JSON summary; the chain events are the record.
 */

import { type CronPayload, cre, consensusIdenticalAggregation, type EVMLog, type HTTPSendRequester, type Runtime } from "@chainlink/cre-sdk";
import { collectionsReceiverAbi, polarisLoanEngineAbi, polarisPaymentsAbi } from "@polarispay/contracts/abi";
import { type Address, parseAbi } from "viem";
import { z } from "zod";
import { base64Utf8 } from "../shared/callback.ts";
import { address, callbackSchema, chainSelectorName, gasSchema, httpUrl } from "../shared/config.ts";
import {
  deliveredTo,
  type EVMClient,
  evmClientFor,
  nowSeconds,
  readContract,
  readReceipt,
  signReport,
  WRITE_SIZED_READS,
  writeSized,
} from "../shared/evm.ts";
import { optionalSecret, postSignedCallback } from "../shared/http.ts";
import { type ChainBackoff, chainBackoffSchema, instalmentDueAt, loanVerdict, subscriptionVerdict } from "./backoff.ts";
import {
  candidatesRequestBody,
  DUE_CANDIDATES_QUERY,
  type IndexerCandidates,
  packCandidates,
  parseIndexerCandidates,
  unpackCandidates,
} from "./candidates.ts";
import { type CollectionsEvent, eventsFor, outcomeFromReceipt, summarize } from "./outcomes.ts";
import { decodeReauthorized, reauthorizedFilter, retrySchema } from "./retry.ts";
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
    indexerUrl: httpUrl.nullable(),
    /** Overrides DUE_CANDIDATES_QUERY for an indexer with another schema. */
    indexerQuery: z.string().min(1).nullable(),
    /** Most candidates of each kind to take from the indexer. */
    indexerLimit: z.number().int().min(1).max(500),
    /** Chain mode: the newest ids of each kind checked every run. */
    recentWindow: z.number().int().min(1).max(500),
    /** Chain mode: older ids checked per run, rotating so each is revisited. */
    sweepWindow: z.number().int().min(0).max(500),
    /**
     * Chain mode: the dunning ladder, counted from each task's due time
     * (./backoff.ts), so a buyer who is short is not retried every run while
     * the indexer is away. Null tries every due task on every run.
     */
    chainBackoff: chainBackoffSchema,
  }),
  /** Liquidate plans past grace when their collection fails. */
  liquidate: z.boolean(),
  /** Tasks per report, bounded by gas: a collection costs about 150k. */
  maxTasksPerReport: z.number().int().min(1).max(60),
  /** Tasks per `checkTasks` read. */
  checkBatch: z.number().int().min(1).max(MAX_CHECK_BATCH),
  gas: gasSchema,
  callback: callbackSchema,
  /**
   * The instant retry (./retry.ts): PolarisCheckout's address and the log
   * confidence for the `Reauthorized` trigger, or null for the cron alone.
   */
  retry: retrySchema.default(null),
});
export type CollectionsConfig = z.infer<typeof configSchema>;

/** CRE's EVM read quota per execution (docs/research/cre.md §8). */
export const EVM_READ_LIMIT = 15;

const COUNTS_ABI = parseAbi([
  "function loanCount() view returns (uint256)",
  "function subscriptionCount() view returns (uint256)",
]);
/** What fired a run: the cron, or a buyer's `Reauthorized` log (the instant retry). */
export type RunTrigger =
  | { kind: "cron"; scheduledAt: number }
  | { kind: "log"; event: "Reauthorized"; buyer: Address; txHash: string; logIndex: number };

export interface CollectionsResult {
  status: "idle" | "written" | "dry-run";
  trigger: RunTrigger;
  /** Where the tasks came from: the indexer or the chain (cron), or the buyer's event (retry). */
  source: "indexer" | "chain" | "event";
  /** Why a configured indexer was not used this run, or null. */
  indexerError: string | null;
  note: string | null;
  checked: number;
  tasks: Array<{ action: string; id: string }>;
  /** Chain mode: due tasks the dunning ladder holds back this run, and when each is next tried. */
  heldBack: Array<{ action: string; id: string; nextAttemptAt: number }>;
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

/**
 * Chain mode: keep only the due tasks the dunning ladder lets this run try
 * (./backoff.ts). One EVM read per task for its due time; a loan past grace
 * needs none (it is always tried). Tasks whose due time the read quota leaves
 * unread wait for a later run rather than be tried blind.
 */
function onTheLadder(
  runtime: Runtime<CollectionsConfig>,
  evm: EVMClient,
  budget: ReadBudget,
  ready: Ready,
  now: number,
  ladder: ChainBackoff,
  reserve: number,
): { ready: Ready; heldBack: CollectionsResult["heldBack"]; unread: number } {
  const cfg = runtime.config;
  const pastGrace = new Set(ready.liquidate.map(String));
  const out: Ready = { collect: [], charge: [], liquidate: ready.liquidate };
  const heldBack: CollectionsResult["heldBack"] = [];
  let unread = 0;
  const read = () => budget.left > reserve && budget.take();
  for (const id of ready.collect) {
    if (pastGrace.has(String(id))) {
      out.collect.push(id);
      continue;
    }
    if (!read()) {
      unread++;
      continue;
    }
    const loan = readContract(runtime, evm, { address: cfg.loanEngine, abi: polarisLoanEngineAbi, functionName: "getLoan", args: [id] }) as {
      startedAt: bigint;
      intervalSeconds: bigint;
      installmentsPaid: number;
    };
    const v = loanVerdict(now, instalmentDueAt(loan), false, ladder);
    if (v.attempt) out.collect.push(id);
    else heldBack.push({ action: "collect", id: id.toString(), nextAttemptAt: v.nextAttemptAt });
  }
  for (const id of ready.charge) {
    if (!read()) {
      unread++;
      continue;
    }
    const sub = readContract(runtime, evm, { address: cfg.payments, abi: polarisPaymentsAbi, functionName: "getSubscription", args: [id] }) as {
      nextChargeAt: bigint;
    };
    const v = subscriptionVerdict(now, Number(sub.nextChargeAt), ladder);
    if (v.attempt) out.charge.push(id);
    else heldBack.push({ action: "charge", id: id.toString(), nextAttemptAt: v.nextAttemptAt });
  }
  return { ready: out, heldBack, unread };
}

export function onCron(runtime: Runtime<CollectionsConfig>, payload: CronPayload): string {
  const cfg = runtime.config;
  const evm = evmClientFor(cfg.chainSelectorName);
  const budget = new ReadBudget(EVM_READ_LIMIT);
  const now = nowSeconds(runtime);
  // The same on every node: the time this run was scheduled for, not a clock read.
  const tick = payload.scheduledExecutionTime?.seconds ?? BigInt(now);
  // Three reads kept back for the write: the receiver's transmitter, the gas estimate and the receipt.
  const RESERVE = 3;

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
      note = `indexer unavailable (${indexed.error}); read candidates from the chain${cfg.candidates.chainBackoff ? ", on the dunning ladder counted from each due time" : ", which has no dunning backoff"}`;
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
  let ready: Ready = {
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
  const addNote = (more: string) => {
    note = note ? `${note}; ${more}` : more;
    runtime.log(more);
  };
  const total = candidates.loans.length + candidates.subscriptions.length;
  if (first.checked < total) {
    addNote(`checked ${first.checked} of ${total} candidates inside the ${EVM_READ_LIMIT}-read quota; the rest wait for the next run`);
  }
  // The indexer's candidates are already on its ladder; the chain's get the same ladder here.
  let heldBack: CollectionsResult["heldBack"] = [];
  const ladder = cfg.candidates.chainBackoff;
  if (source === "chain" && ladder && ready.collect.length + ready.charge.length > 0) {
    const kept = onTheLadder(runtime, evm, budget, ready, Number(tick), ladder, RESERVE);
    ready = kept.ready;
    heldBack = kept.heldBack;
    if (heldBack.length > 0) addNote(`${heldBack.length} due task(s) held back by the dunning ladder until their next rung`);
    if (kept.unread > 0) addNote(`${kept.unread} due task(s) wait for a later run: no read left for their due time`);
  }

  const tasks = planTasks(ready, cfg.maxTasksPerReport);
  const base: CollectionsResult = {
    ...emptyResult({ kind: "cron", scheduledAt: Number(tick) }, source),
    indexerError,
    note,
    checked,
    tasks: taskList(tasks),
    heldBack,
  };
  return deliver(runtime, evm, budget, tasks, base, {
    indexerError,
    // No transaction to key an idle run's callback on: the scheduled tick is the same on every node.
    idleId: `collections:${tick}`,
    idleLog: `nothing due among ${checked} checks (${source})`,
    now,
  });
}

/**
 * The instant retry's handler: a buyer re-signed (`PolarisCheckout.reauthorize`
 * emitted `Reauthorized`), so their due instalments are collected now, in one
 * report through the same path as the cron's, instead of at the next rung of
 * the dunning ladder. `CollectionsReceiver.dueTasksFor(buyer)` at the last
 * finalized block says which: one collect task per plan of theirs whose
 * instalment is due. Nothing due (they re-signed before it fell due) writes
 * nothing; the cron collects it then. Liquidation stays the cron's: a buyer
 * who has just re-signed is collected, not liquidated.
 */
export function onReauthorized(runtime: Runtime<CollectionsConfig>, log: EVMLog): string {
  const cfg = runtime.config;
  if (!cfg.retry) throw new Error("retry is null in this config, so the Reauthorized trigger should not be registered");
  const ev = decodeReauthorized(log, cfg.retry.checkout);
  const trigger: RunTrigger = { kind: "log", event: "Reauthorized", buyer: ev.buyer, txHash: ev.txHash, logIndex: ev.logIndex };
  const base = emptyResult(trigger, "event");
  runtime.log(`Reauthorized: ${ev.buyer} re-signed for ${ev.value} (tx ${ev.txHash}, block ${ev.blockNumber ?? "?"})`);
  if (ev.removed) {
    runtime.log("the log was removed by a reorg: nothing to collect on it");
    return JSON.stringify({ ...base, note: "the Reauthorized log was removed by a reorg" });
  }

  const evm = evmClientFor(cfg.chainSelectorName);
  const budget = new ReadBudget(EVM_READ_LIMIT);
  budget.take();
  const due = readContract(runtime, evm, {
    address: cfg.receiver,
    abi: collectionsReceiverAbi,
    functionName: "dueTasksFor",
    args: [ev.buyer],
  }) as ReadonlyArray<{ action: number; id: bigint }>;
  const collectable = due.filter((t) => t.action === ACTION.COLLECT_INSTALLMENT);
  const tasks: Task[] = collectable.slice(0, cfg.maxTasksPerReport).map((t) => ({ action: ACTION.COLLECT_INSTALLMENT, id: t.id }));
  let note: string | null = null;
  if (collectable.length > tasks.length) {
    note = `${collectable.length - tasks.length} more due instalment(s) of ${ev.buyer} wait for the cron (maxTasksPerReport)`;
    runtime.log(note);
  }
  return deliver(runtime, evm, budget, tasks, { ...base, note, checked: due.length, tasks: taskList(tasks) }, {
    indexerError: null,
    idleId: `collections:reauthorized:${ev.txHash}:${ev.logIndex}`,
    idleLog: `nothing due for ${ev.buyer}: the cron collects when the next instalment falls due`,
    now: nowSeconds(runtime),
  });
}

function emptyResult(trigger: RunTrigger, source: CollectionsResult["source"]): CollectionsResult {
  return {
    status: "idle",
    trigger,
    source,
    indexerError: null,
    note: null,
    checked: 0,
    tasks: [],
    heldBack: [],
    txHash: null,
    gasLimit: null,
    executed: 0,
    skipped: 0,
    events: 0,
    callbackStatus: null,
  };
}

const taskList = (tasks: readonly Task[]) => tasks.map((t) => ({ action: ["", "collect", "charge", "liquidate"][t.action]!, id: t.id.toString() }));

/**
 * Steps 3 and 4, the same for both triggers: one signed report for `tasks`
 * (`abi.encode(uint8 1, (uint8 action, uint256 id)[])`), gas sized from its
 * own estimate (of `onReport` as the forwarder calls it or, behind a
 * simulation transmitter, of the whole delivery from it), the receipt read
 * back (simulation calls a reverted receiver a success), skip reasons turned
 * into dunning events, and the signed callback. No tasks, no write.
 */
function deliver(
  runtime: Runtime<CollectionsConfig>,
  evm: EVMClient,
  budget: ReadBudget,
  tasks: Task[],
  base: CollectionsResult,
  ctx: { indexerError: string | null; idleId: string; idleLog: string; now: number },
): string {
  const cfg = runtime.config;
  /** The signed run callback: whenever a task moved or failed, and whenever the indexer failed. */
  const callBack = (result: CollectionsResult, run: { id: string; txHash: string | null; tally: CallbackTally; events: CollectionsEvent[] }) => {
    if (!cfg.callback || (run.events.length === 0 && ctx.indexerError === null)) return;
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
        createdAt: ctx.now,
        chain: cfg.chainSelectorName,
        receiver: cfg.receiver,
        txHash: run.txHash,
        trigger: result.trigger,
        candidates: { source: result.source, indexerError: ctx.indexerError },
        tally: run.tally,
        events: run.events,
      },
    });
    runtime.log(`callback ${cfg.callback.url} answered ${result.callbackStatus}`);
  };

  if (tasks.length === 0) {
    runtime.log(ctx.idleLog);
    callBack(base, { id: ctx.idleId, txHash: null, tally: { tasks: 0, executed: 0, skipped: 0 }, events: [] });
    return JSON.stringify(base);
  }

  // 3. One report, gas sized from its own estimate.
  const report = signReport(runtime, encodeCollectionsReport(tasks));
  budget.take(WRITE_SIZED_READS);
  const write = writeSized(runtime, evm, { forwarder: cfg.forwarder, receiver: cfg.receiver, report, gas: cfg.gas });
  runtime.log(`wrote ${tasks.length} tasks, gas limit ${write.gasLimit} (estimate ${write.estimate}), tx ${write.txHash}`);
  const result: CollectionsResult = { ...base, status: "written", txHash: write.txHash, gasLimit: write.gasLimit.toString() };
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

/**
 * Trigger 0: the cron. Trigger 1, when `retry` is set: the EVM log trigger on
 * PolarisCheckout's `Reauthorized` (`--trigger-index 1` under simulate).
 */
export const initWorkflow = (config: CollectionsConfig) => {
  const cron = cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron);
  if (!config.retry) return [cron];
  const retry = cre.handler(evmClientFor(config.chainSelectorName).logTrigger(reauthorizedFilter(config.retry)), onReauthorized);
  return [cron, retry];
};
