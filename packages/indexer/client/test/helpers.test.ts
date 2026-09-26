/**
 * The pure helpers: CRE task building, webhook events, money and the credit
 * line mirror (kept equal to the indexer's own copy).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creditLimitOf as indexerCreditLimit } from "../../src/lib/credit.js";
import {
  committed,
  creditLimitOf,
  dueCandidatesRequest,
  formatUsd,
  fromCents,
  nextCursor,
  parseDueCandidates,
  readyTasks,
  toCents,
  toWebhookEvent,
  type Activity,
} from "../src/index.js";

describe("CRE candidates", () => {
  it("validates its inputs", () => {
    assert.throws(() => dueCandidatesRequest(0));
    assert.throws(() => dueCandidatesRequest(1_790_000_000, 0));
    assert.deepEqual(dueCandidatesRequest(1_790_000_000, 10).variables, { now: 1_790_000_000, limit: 10 });
  });

  const NOW = 1_790_000_000;
  const due = (loanId: string | number, liquidatableAt: number | null = NOW + 3_601) => ({ loanId, liquidatableAt });

  it("builds the same ordered, deduplicated list whatever order the rows come in", () => {
    const a = parseDueCandidates({ data: { Loan: [due("5"), due("2", NOW - 1), due("5")], Subscription: [{ subId: 7 }, { subId: 1 }] } }, NOW);
    const b = parseDueCandidates({ Loan: [due(2, NOW), due(5)], Subscription: [{ subId: "1" }, { subId: "7" }] }, NOW);
    assert.deepEqual(a, b);
    // Loan 2 is past grace: liquidated, not collected.
    assert.deepEqual(a, [
      { action: 3, id: 2n },
      { action: 1, id: 5n },
      { action: 2, id: 1n },
      { action: 2, id: 7n },
    ]);
  });

  it("caps the list at what one checkTasks read can carry, and keeps only ready tasks", () => {
    const many = { Loan: Array.from({ length: 400 }, (_, i) => due(i + 1)) };
    assert.equal(parseDueCandidates(many, NOW).length, 72);
    const tasks = parseDueCandidates({ Loan: [due(1), due(2)] }, NOW);
    assert.deepEqual(readyTasks(tasks, [false, true]), [{ action: 1, id: 2n }]);
    assert.throws(() => readyTasks(tasks, [true]));
  });

  it("refuses an answer with errors", () => {
    assert.throws(() => parseDueCandidates({ errors: [{ message: "boom" }] }, NOW), /boom/);
  });
});

describe("webhook events", () => {
  const base: Activity = {
    id: "12000000010",
    cursor: 12_000_000_010n,
    kind: "installment.failed",
    merchant_id: "0x11",
    buyer: "0x22",
    orderId: "logo-work",
    orderKey: "0xab",
    mode: null,
    amount: 50_383_562n,
    fee: null,
    refId: "1",
    installmentIndex: 0,
    reason: "InsufficientBalance",
    reasonAction: "TOP_UP",
    destination: null,
    timestamp: 1_790_000_000,
    blockNumber: 1200,
    logIndex: 1,
    txHash: "0xfeed",
  };

  it("is the SDK's envelope, with a stable id and only the fields that apply", () => {
    const event = toWebhookEvent(base, { merchantId: "mer_123" });
    assert.equal(event.id, "evt_12000000010");
    assert.equal(event.object, "event");
    assert.equal(event.type, "installment.failed");
    assert.equal(event.createdAt, "2026-09-21T14:13:20.000Z");
    assert.equal(event.livemode, false);
    assert.equal(event.merchantId, "mer_123");
    assert.equal(toWebhookEvent(base).merchantId, "0x11");
    assert.deepEqual(event.data, {
      merchant: "0x11",
      id: "1",
      amount: "50383562",
      currency: "ausd",
      orderId: "logo-work",
      orderKey: "0xab",
      buyer: "0x22",
      installmentIndex: 0,
      reason: "InsufficientBalance",
      reasonAction: "TOP_UP",
      transaction: { hash: "0xfeed", blockNumber: 1200, logIndex: 1 },
      cursor: "12000000010",
    });
    assert.equal(JSON.parse(JSON.stringify(event)).data.amount, "50383562");
  });

  it("delivers only committed rows and resumes after the last one", () => {
    const later = { ...base, cursor: 13_000_000_000n, blockNumber: 1300 };
    assert.deepEqual(committed([base, later], 1250), [base]);
    assert.deepEqual(committed([base], null), []);
    assert.equal(nextCursor(0n, [base, later]), 13_000_000_000n);
    assert.equal(nextCursor(99n, []), 99n);
  });
});

describe("money", () => {
  it("converts base units to cents without floats", () => {
    assert.equal(toCents(50_383_562n), 5038);
    assert.equal(toCents(125_000n), 13); // half a cent rounds up
    assert.equal(toCents(-125_000n), -13);
    assert.equal(fromCents(5038), 50_380_000n);
    assert.equal(formatUsd(1_234_567_890n), "$1,234.57");
    assert.equal(formatUsd(0n), "$0.00");
  });
});

describe("credit line", () => {
  it("matches the indexer's ScoreManager mirror everywhere", () => {
    for (const score of [300, 579, 580, 669, 670, 739, 740, 799, 800, 850]) {
      for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
        for (const collateral of [0n, 100_000_000n]) {
          const b = { score, hasRecord: Boolean(flags & 1), declined: Boolean(flags & 2), underwritten: Boolean(flags & 4), collateral };
          for (const s of [
            { requireUnderwriting: true, collateralCountsTowardLimits: true, collateralMultiplierBps: 15_000 },
            { requireUnderwriting: false, collateralCountsTowardLimits: false, collateralMultiplierBps: 30_000 },
          ]) {
            assert.equal(creditLimitOf(b, s), indexerCreditLimit(b, s), JSON.stringify({ ...b, collateral: String(collateral), ...s }));
          }
        }
      }
    }
  });
});
