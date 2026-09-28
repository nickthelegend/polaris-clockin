/**
 * The thin-file gate on its own: which facts the DON will not attest.
 */

import { describe, expect, test } from "bun:test";
import { scoreFromFacts } from "@polarispay/underwriting/core";
import { type ThinCheckFacts, thinFileReason } from "../src/underwriting/thin.ts";

const ZERO: ThinCheckFacts = {
  walletAgeDays: 0,
  txCount: 0,
  stableBalance: 0n,
  defiTenureDays: 0,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: false,
};
const f = (over: Partial<ThinCheckFacts>): ThinCheckFacts => ({ ...ZERO, ...over });
const thin = (over: Partial<ThinCheckFacts>) => thinFileReason(f(over)) !== null;

describe("thinFileReason", () => {
  test("an empty account is thin, although ScoreManager would open it at the $200 floor", () => {
    expect(scoreFromFacts({ ...ZERO, observedAt: 0n }).score).toBe(520);
    expect(thinFileReason(ZERO)).toContain("thin file");
  });

  test("dollars alone do not count: they can be moved from account to account", () => {
    expect(thin({ stableBalance: 5_000_000_000n })).toBe(true);
  });

  test("just under either of ScoreManager's minimums is still thin", () => {
    expect(thin({ walletAgeDays: 89, txCount: 500, defiTenureDays: 400, exchangeFunded: true, stableBalance: 99_000_000n })).toBe(true);
    expect(thin({ walletAgeDays: 900, txCount: 9, exchangeFunded: true })).toBe(true);
  });

  test("ScoreManager.isThinFile's rule exactly: 90 days and 10 transactions clear it", () => {
    expect(thin({ walletAgeDays: 90, txCount: 10 })).toBe(false);
    expect(thin({ walletAgeDays: 1200, txCount: 900, exchangeFunded: true })).toBe(false);
    // One point from time or identity is not enough: the chain would refuse the report with ThinFile.
    expect(thin({ walletAgeDays: 30 })).toBe(true);
    expect(thin({ txCount: 25 })).toBe(true);
    expect(thin({ defiTenureDays: 30 })).toBe(true);
    expect(thin({ exchangeFunded: true })).toBe(true);
  });

  test("penalties alone do not make a file: one liquidation and nothing else is still thin", () => {
    expect(thin({ priorLiquidations: 1 })).toBe(true);
    expect(thin({ relatedWallets: 10 })).toBe(true);
  });

  test("a declined file is always reported, so the decline and the wallet's link stick", () => {
    expect(thin({ priorLiquidations: 2 })).toBe(false);
    expect(thin({ relatedWallets: 25 })).toBe(false);
  });
});
