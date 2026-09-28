/**
 * The dunning ladder the collections workflow keeps when the chain proposes
 * its candidates (src/collections/backoff.ts): the same rungs the indexer
 * schedules, counted from the due time.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_LADDER_SECONDS,
  instalmentDueAt,
  loanVerdict,
  nextRung,
  onRung,
  SUBSCRIPTION_CHARGE_WINDOW_SECONDS,
  subscriptionVerdict,
} from "../src/collections/backoff.ts";
import { fs } from "./helpers/host.ts";

const H = 3600;
const ladder = { ladderSeconds: [...DEFAULT_LADDER_SECONDS], windowSeconds: 60 };
const DUE = 1_790_000_000;

describe("onRung", () => {
  test("rungs at due, +6 h, then 24 h, 72 h and 168 h after the one before, and 168 h from then on", () => {
    const rungs = [0, 6, 30, 102, 270, 438, 606].map((h) => DUE + h * H);
    for (const r of rungs) {
      expect(onRung(r, DUE, ladder)).toBe(true);
      expect(onRung(r + 59, DUE, ladder)).toBe(true);
      expect(onRung(r + 60, DUE, ladder)).toBe(false);
    }
    expect(onRung(DUE - 1, DUE, ladder)).toBe(false); // not due yet
    expect(onRung(DUE + 3 * H, DUE, ladder)).toBe(false); // between rungs 0 and 1
    expect(onRung(DUE + 29 * H, DUE, ladder)).toBe(false); // between rungs 1 and 2
  });

  test("a run every `windowSeconds` tries each rung exactly once", () => {
    let attempts = 0;
    for (let t = DUE - 600; t < DUE + 700 * H; t += ladder.windowSeconds) if (onRung(t, DUE, ladder)) attempts++;
    // Rungs at 0, 6, 30, 102, 270, 438 and 606 h fall inside 700 h.
    expect(attempts).toBe(7);
  });

  test("the first rung at or after now is the next attempt", () => {
    expect(nextRung(DUE + 3 * H, DUE, ladder)).toBe(DUE + 6 * H);
    expect(nextRung(DUE + 6 * H, DUE, ladder)).toBe(DUE + 6 * H);
    expect(nextRung(DUE + 31 * H, DUE, ladder)).toBe(DUE + 102 * H);
    expect(nextRung(DUE - 5, DUE, ladder)).toBe(DUE);
  });
});

describe("verdicts", () => {
  test("a loan past grace is always tried (collection first, liquidation if it fails)", () => {
    expect(loanVerdict(DUE + 3 * H, DUE, true, ladder)).toEqual({ attempt: true, why: "past-grace" });
    expect(loanVerdict(DUE + 3 * H, DUE, false, ladder)).toEqual({ attempt: false, nextAttemptAt: DUE + 6 * H });
    expect(loanVerdict(DUE + 10, DUE, false, ladder)).toEqual({ attempt: true, why: "on-rung" });
  });

  test("a renewal waits on the ladder, never past its charge window, and is always tried after it", () => {
    expect(subscriptionVerdict(DUE + 3 * H, DUE, ladder)).toEqual({ attempt: false, nextAttemptAt: DUE + 6 * H });
    // Rung 4 would be 270 h after due, past the 168 h window: the wait stops where the window closes.
    expect(subscriptionVerdict(DUE + 103 * H, DUE, ladder)).toEqual({ attempt: false, nextAttemptAt: DUE + SUBSCRIPTION_CHARGE_WINDOW_SECONDS + 1 });
    expect(subscriptionVerdict(DUE + SUBSCRIPTION_CHARGE_WINDOW_SECONDS + 1, DUE, ladder)).toEqual({ attempt: true, why: "past-charge-window" });
  });

  test("a loan's due time is its next unpaid instalment's", () => {
    expect(instalmentDueAt({ startedAt: 1_000n, intervalSeconds: 604_800n, installmentsPaid: 0 })).toBe(605_800);
    expect(instalmentDueAt({ startedAt: 1_000n, intervalSeconds: 604_800n, installmentsPaid: 2 })).toBe(1_000 + 3 * 604_800);
  });
});

describe("the ladder is the indexer's", () => {
  const ROOT = join(import.meta.dir, "..", "..");
  test("packages/indexer schedules retries with the same steps", () => {
    const deployment = fs.readFileSync(join(ROOT, "packages", "indexer", "src", "deployment.ts"), "utf8");
    const m = /"dunningRetrySeconds":\s*\[([^\]]+)\]/.exec(deployment);
    expect(m).not.toBeNull();
    expect(m![1]!.split(",").map((x: string) => Number(x.trim()))).toEqual([...DEFAULT_LADDER_SECONDS]);
  });

  test("and the committed configs use it: one attempt per rung at each target's pace", () => {
    const json = (p: string) => JSON.parse(fs.readFileSync(join(ROOT, "workflows", p), "utf8"));
    const staging = json("collections/config.staging.json");
    const production = json("collections/config.production.json");
    expect(staging.candidates.chainBackoff).toEqual({ ladderSeconds: [...DEFAULT_LADDER_SECONDS], windowSeconds: 120 });
    // Production's cron fires once a day.
    expect(production.schedule).toBe("0 0 14 * * *");
    expect(production.candidates.chainBackoff).toEqual({ ladderSeconds: [...DEFAULT_LADDER_SECONDS], windowSeconds: 86_400 });
  });
});
