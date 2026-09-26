/**
 * Skip reasons → dunning, candidates from the indexer, and the signed
 * callback: the pure pieces of the collections workflow.
 */

import { describe, expect, test } from "bun:test";
import { polarisLoanEngineAbi, polarisPaymentsAbi } from "@polarispay/contracts/abi";
import { encodeErrorResult, type Hex, parseAbi } from "viem";
import { packCandidates, parseIndexerCandidates, unpackCandidates } from "../src/collections/candidates.ts";
import { classifySkip, eventsFor } from "../src/collections/outcomes.ts";
import { ACTION } from "../src/collections/tasks.ts";
import { signCallback, verifyCallback } from "../src/shared/callback.ts";
import { crypto } from "./helpers/host.ts";

const engine = (name: string, args: readonly unknown[] = []) =>
  encodeErrorResult({ abi: polarisLoanEngineAbi, errorName: name as never, args: args as never });
const payments = (name: string) => encodeErrorResult({ abi: polarisPaymentsAbi, errorName: name as never });
const token = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);

describe("classifySkip: the engine's errors say which rung of the ladder", () => {
  test("a lost allowance means sign again, a short balance means top up", () => {
    expect(classifySkip(engine("InsufficientAllowance", [1n, 50n]))).toEqual({ class: "reauthorize", error: "InsufficientAllowance", have: 1n, need: 50n });
    expect(classifySkip(engine("InsufficientBalance", [2n, 50n]))).toEqual({ class: "top_up", error: "InsufficientBalance", have: 2n, need: 50n });
  });

  test("subscriptions pull through the token: its ERC-20 errors map the same way", () => {
    const spender = "0x0000000000000000000000000000000000000001";
    expect(classifySkip(encodeErrorResult({ abi: token, errorName: "ERC20InsufficientAllowance", args: [spender, 3n, 9n] })).class).toBe("reauthorize");
    expect(classifySkip(encodeErrorResult({ abi: token, errorName: "ERC20InsufficientBalance", args: [spender, 3n, 9n] }))).toEqual({
      class: "top_up",
      error: "ERC20InsufficientBalance",
      have: 3n,
      need: 9n,
    });
  });

  test("stale candidates are nobody's fault", () => {
    for (const e of ["NotDue", "LoanNotActive", "InvalidLoan", "NotLiquidatable"]) expect(classifySkip(engine(e)).class).toBe("stale");
    expect(classifySkip(payments("SubscriptionNotActive")).class).toBe("stale");
  });

  test("anything else goes to a person, never silently dropped", () => {
    expect(classifySkip("0x")).toMatchObject({ class: "unknown" });
    expect(classifySkip("0xdeadbeef")).toMatchObject({ class: "unknown", error: "unknown(0xdeadbeef)" });
    expect(classifySkip(engine("ZeroAmount")).class).toBe("unknown");
  });
});

describe("eventsFor", () => {
  const tx = `0x${"ab".repeat(32)}` as Hex;
  test("one event per task that moved money or needs a person, with stable ids", () => {
    const events = eventsFor(tx, {
      executed: [
        { action: ACTION.COLLECT_INSTALLMENT, id: 1n, amount: 50_383_562n },
        { action: ACTION.LIQUIDATE, id: 4n, amount: 0n },
      ],
      skipped: [
        { action: ACTION.COLLECT_INSTALLMENT, id: 2n, class: "top_up", error: "InsufficientBalance", have: 1n, need: 2n },
        { action: ACTION.COLLECT_INSTALLMENT, id: 3n, class: "stale", error: "NotDue", have: null, need: null },
        { action: ACTION.CHARGE_SUBSCRIPTION, id: 7n, class: "reauthorize", error: "ERC20InsufficientAllowance", have: 0n, need: 9n },
      ],
      tally: { tasks: 5n, executed: 2n, skipped: 3n },
    });
    expect(events).toEqual([
      { id: `${tx}:collect:1`, type: "installment.collected", loanId: "1", amount: "50383562" },
      { id: `${tx}:liquidate:4`, type: "plan.liquidated", loanId: "4" },
      { id: `${tx}:collect:2`, type: "installment.failed", loanId: "2", reason: "top_up", error: "InsufficientBalance", have: "1", need: "2" },
      {
        id: `${tx}:charge:7`,
        type: "subscription.charge_failed",
        subscriptionId: "7",
        reason: "reauthorize",
        error: "ERC20InsufficientAllowance",
        have: "0",
        need: "9",
      },
    ]);
  });
});

describe("indexer candidates", () => {
  test("reads loanId / subId as numbers or strings, and ids keyed by chain or engine", () => {
    const c = parseIndexerCandidates({
      data: { Loan: [{ loanId: "3" }, { loanId: 1 }, { id: "0xengine-12" }, { loanId: "3" }], Subscription: [{ subId: "2" }, { id: "10143_5" }] },
    });
    expect(c).toEqual({ loans: [1n, 3n, 12n], subscriptions: [2n, 5n] });
  });

  test("GraphQL errors and unknown shapes throw, so the run falls back to the chain", () => {
    expect(() => parseIndexerCandidates({ errors: [{ message: "boom" }] })).toThrow("indexer: boom");
    expect(() => parseIndexerCandidates({ data: {} })).toThrow(/neither Loan nor Subscription/);
    expect(() => parseIndexerCandidates("nope")).toThrow();
  });

  test("pack and unpack for identical consensus", () => {
    const c = { loans: [1n, 2n], subscriptions: [] };
    expect(packCandidates(c)).toBe("L:1,2|S:");
    expect(unpackCandidates(packCandidates(c))).toEqual(c);
    expect(unpackCandidates("ERR:HTTP 502")).toEqual({ error: "HTTP 502" });
    expect(unpackCandidates("garbage")).toHaveProperty("error");
  });
});

describe("signed callbacks", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "x", events: [] });

  test("the same Stripe-style header packages/db signs merchant webhooks with", () => {
    const t = 1_790_000_000;
    const mac = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(signCallback(secret, body, t)).toBe(`t=${t},v1=${mac}`);
  });

  test("verifies, and refuses a tampered body, a wrong secret, a replay outside tolerance or a malformed header", () => {
    const t = 1_790_000_000;
    const header = signCallback(secret, body, t);
    expect(verifyCallback(secret, body, header, t + 10)).toEqual({ ok: true, timestamp: t });
    expect(verifyCallback(secret, `${body} `, header, t)).toEqual({ ok: false, reason: "signature mismatch" });
    expect(verifyCallback("other", body, header, t)).toEqual({ ok: false, reason: "signature mismatch" });
    expect(verifyCallback(secret, body, header, t + 301)).toEqual({ ok: false, reason: "timestamp outside tolerance" });
    expect(verifyCallback(secret, body, "v1=abc", t)).toEqual({ ok: false, reason: "malformed signature header" });
    expect(verifyCallback(secret, body, undefined, t)).toEqual({ ok: false, reason: "missing signature header" });
  });
});
