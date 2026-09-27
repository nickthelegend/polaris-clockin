import "server-only";

import { getConfig } from "./env";
import { runUnderwritingQueue } from "./credit/underwriting";
import { reconcileRelays, syncChain } from "./ingest/sync";
import { runPayoutSweep } from "./payouts/payouts";
import { dispatchDue } from "./webhooks/dispatcher";

/**
 * The background work: follow the chain, finish relays whose receipt came
 * late, deliver and retry webhooks, and run automatic payouts.
 *
 * On a long-running server (`next start`, `next dev`) `startWorkers` runs
 * each on a timer from `instrumentation.ts`. On serverless, point a
 * scheduler at `POST /api/cron/tick` (Bearer CRON_SECRET) every minute; it
 * runs one pass of everything.
 */

export type TickSummary = Record<string, unknown>;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[workers] ${name} failed`, error);
    return { error: (error as Error).message };
  }
}

export async function runTick(): Promise<TickSummary> {
  const chain = getConfig().chain !== null;
  return {
    chain: chain ? await step("chain sync", () => syncChain()) : "not configured",
    relays: chain ? await step("relay reconcile", () => reconcileRelays()) : "not configured",
    webhooks: await step("webhooks", () => dispatchDue({ limit: 100 })),
    payouts: chain ? await step("payouts", () => runPayoutSweep()) : "not configured",
    underwriting: chain ? await step("underwriting", () => runUnderwritingQueue()) : "not configured",
  };
}

type Loop = { name: string; everyMs: number; run: () => Promise<unknown> };

const g = globalThis as typeof globalThis & { __polarisWorkers?: NodeJS.Timeout[] };

export function startWorkers(): void {
  const config = getConfig();
  if (!config.workers || g.__polarisWorkers) return;
  const loops: Loop[] = [{ name: "webhooks", everyMs: 3_000, run: () => dispatchDue() }];
  if (config.chain) {
    loops.push(
      { name: "chain sync", everyMs: 2_000, run: () => syncChain({ maxRanges: 5 }) },
      { name: "relay reconcile", everyMs: 5_000, run: () => reconcileRelays() },
      { name: "payouts", everyMs: 5 * 60_000, run: () => runPayoutSweep() },
      { name: "underwriting", everyMs: 5_000, run: () => runUnderwritingQueue() },
    );
  }
  g.__polarisWorkers = loops.map((loop) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      loop
        .run()
        .catch((error) => console.error(`[workers] ${loop.name} failed`, error))
        .finally(() => {
          busy = false;
        });
    }, loop.everyMs);
    timer.unref?.();
    return timer;
  });
  console.log(`[workers] started: ${loops.map((l) => l.name).join(", ")}`);
}

export function stopWorkers(): void {
  for (const t of g.__polarisWorkers ?? []) clearInterval(t);
  g.__polarisWorkers = undefined;
}
