/**
 * guardian:local's one line per run (.demo/logs/cre-guardian.log): where the
 * price came from, the verdict, and what was written, so a reader of the log
 * can tell Chainlink's feed from the local mock and a write from a no-op.
 */

import { describe, expect, test } from "bun:test";
// @ts-expect-error: a plain ESM script, no type declarations
import { describeRun } from "../scripts/local-guardian.mjs";

const base = {
  status: "unchanged",
  why: "unchanged",
  transition: "unchanged",
  verdict: { creditPaused: false, reasons: 0, reasonNames: [] as string[] },
  price: { kind: "chainlink", description: "AUSD / USD", answer: "0.99983039", roundId: "18446744073709559173", ageSeconds: 53 },
  thresholds: { minPrice: "0.995" },
  round: null as string | null,
  txHash: null as string | null,
  refusal: null as string | null,
};

describe("describeRun", () => {
  test("names Chainlink's feed, the verdict and a no-op", () => {
    expect(describeRun(base)).toBe(
      "Chainlink AUSD / USD 0.99983039 (round 18446744073709559173, 53 s old); min 0.995; healthy; unchanged; no write (unchanged)",
    );
  });

  test("a pause that was written, with its round and transaction", () => {
    const paused = {
      ...base,
      status: "written",
      why: "verdict",
      transition: "paused",
      verdict: { creditPaused: true, reasons: 1, reasonNames: ["depeg"] },
      thresholds: { minPrice: "1.001" },
      round: "2",
      txHash: "0xabc",
    };
    expect(describeRun(paused)).toBe(
      "Chainlink AUSD / USD 0.99983039 (round 18446744073709559173, 53 s old); min 1.001; PAUSE Pay in 4 (depeg); paused; wrote round 2, tx 0xabc",
    );
  });

  test("the local mock is never called Chainlink, and a refusal says why", () => {
    const refused = { ...base, status: "refused", price: { ...base.price, kind: "mock", description: "AUSD / USD (local mock, not Chainlink)" }, refusal: "AttestationOutOfOrder(5, 6)", txHash: "0xdef" };
    const line = describeRun(refused);
    expect(line.startsWith("mock AUSD / USD (local mock, not Chainlink)")).toBe(true);
    expect(line).toContain("refused: AttestationOutOfOrder(5, 6), tx 0xdef");
  });
});
