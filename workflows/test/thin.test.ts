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

  test("just under every step is still thin", () => {
    expect(thin({ walletAgeDays: 29, txCount: 24, defiTenureDays: 29, stableBalance: 99_000_000n })).toBe(true);
  });

  test("one point from time or identity is enough", () => {
    expect(thin({ walletAgeDays: 30 })).toBe(false);
    expect(thin({ txCount: 25 })).toBe(false);
    expect(thin({ defiTenureDays: 30 })).toBe(false);
    expect(thin({ exchangeFunded: true })).toBe(false);
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
