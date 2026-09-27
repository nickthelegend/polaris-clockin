import { describe, expect, it } from "vitest";

import { PAY_IN_4, formatBaseUnits, formatUsd, normaliseAmount, quotePayIn4, toBaseUnits, toCents } from "../src/money.js";

describe("amounts", () => {
  it("canonicalises decimal strings and exact numbers", () => {
    expect(normaliseAmount("200")).toBe("200.00");
    expect(normaliseAmount("200.5")).toBe("200.50");
    expect(normaliseAmount(" 19.99 ")).toBe("19.99");
    expect(normaliseAmount(200.5)).toBe("200.50");
  });

  it("refuses anything that isn't a positive whole number of cents", () => {
    for (const bad of ["", "0", "0.00", "-1", "1.001", "1e3", "$5", "1,000.00", "abc"]) {
      expect(() => toCents(bad), bad).toThrow(/amount/);
    }
    expect(() => toCents(0.1 + 0.2)).toThrow(/cents/);
    expect(() => toCents(Number.NaN)).toThrow();
  });

  it("converts to and from token base units without floats", () => {
    expect(toBaseUnits("25.00", 6)).toBe(25_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(() => toBaseUnits("0.0000001", 6)).toThrow(/6 decimals/);
    expect(formatBaseUnits(1_534_246n, 6)).toBe("1.534246");
    expect(formatBaseUnits(50_000_000n, 6)).toBe("50.00");
    expect(formatBaseUnits(50_100_000n, 6)).toBe("50.10");
  });

  it("formats USD deterministically", () => {
    expect(formatUsd(128_450n)).toBe("$1,284.50");
    expect(formatUsd(5_038n)).toBe("$50.38");
    expect(formatUsd(-100n)).toBe("−$1.00");
    expect(formatUsd(123_456_789_012n)).toBe("$1,234,567,890.12");
  });
});

describe("Pay in 4 quote", () => {
  it("matches the loan engine: $200 at 10% over four weekly instalments is 4 × $50.38", () => {
    const q = quotePayIn4("200.00");
    expect(q.each).toBe("50.38");
    expect(q.interest).toBe("1.53");
    expect(q.total).toBe("201.53");
    expect(q.aprBps).toBe(PAY_IN_4.aprBps);
    expect(q.intervalSeconds).toBe(7 * 86_400);
    expect(q.interestFree).toBe(false);
    expect(q.installments.map((i) => i.dueInSeconds)).toEqual([0, 604_800, 1_209_600, 1_814_400]);
  });

  it("computes interest in base units exactly as PolarisLoanEngine.createLoan does", () => {
    // interest = principal * 1000 * (4 * 7d) / (10_000 * 365d), floored
    const principal = 200_000_000n;
    const expected = (principal * 1000n * 4n * 604_800n) / (10_000n * 31_536_000n);
    const q = quotePayIn4("200.00");
    const total = q.installments.reduce((sum, i) => sum + i.amountBaseUnits, 0n);
    expect(total).toBe(principal + expected);
    // The last instalment absorbs the remainder, as in the app's quote.
    expect(q.installments[3]!.amountBaseUnits - q.installments[0]!.amountBaseUnits).toBeGreaterThanOrEqual(0n);
    expect(q.installments[3]!.amountBaseUnits - q.installments[0]!.amountBaseUnits).toBeLessThan(4n);
  });

  it("reads interest-free at 0% APR", () => {
    const q = quotePayIn4("200.00", { aprBps: 0 });
    expect(q.each).toBe("50.00");
    expect(q.interest).toBe("0.00");
    expect(q.interestFree).toBe(true);
  });

  it("rounds half up to the cent for display", () => {
    const q = quotePayIn4("201.50", { aprBps: 0 });
    // 201.50 / 4 = 50.375 → "50.38"
    expect(q.each).toBe("50.38");
  });

  it("validates its options", () => {
    expect(() => quotePayIn4("10.00", { installments: 0 })).toThrow(/installments/);
    expect(() => quotePayIn4("10.00", { intervalSeconds: 5 })).toThrow(/intervalSeconds/);
    expect(() => quotePayIn4("10.00", { aprBps: -1 })).toThrow(/aprBps/);
  });
});
