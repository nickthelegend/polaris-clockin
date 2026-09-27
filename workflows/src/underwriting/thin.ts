/**
 * The thin-file gate: facts the workflow will not attest.
 *
 * ScoreManager opens every underwritten account at UNDERWRITE_FLOOR (520) and
 * adds what the facts earn, and 520 already reads as the $200 tier. So a
 * report about an account with no history at all (every fact zero) opens a
 * $200 unsecured line, and such an account costs nothing to make: one person
 * could open a Polaris account per email address, have each one underwritten
 * at the floor, spend every line at a merchant they control and never repay.
 * The sybil checks (relatedWallets, the one-link rule) only ever look at a
 * linked history wallet, so they do not stop this.
 *
 * So the DON attests only facts that show something a brand-new account
 * cannot: at least one point from a signal that takes time or a real identity
 * to earn. In ScoreManager's own step sizes (`scoreFromFacts`):
 *
 *   walletAgeDays   >= 30   (2 points per 30 days)
 *   txCount         >= 25   (1 point per 25 sends)
 *   defiTenureDays  >= 30   (1 point per 30 days)
 *   exchangeFunded          (10 points: an exchange's KYC stands behind it)
 *
 * The stablecoin balance does not count: the same dollars can be moved
 * through account after account inside the 15 minutes a report is good for.
 *
 * A thin file gets no report at all, rather than a report of zeros. That
 * leaves the account where `requireUnderwriting` puts every account before
 * its report: no unsecured line, collateral at face value. And because
 * `ScoreManager.underwrite` runs once per account, it keeps the door open:
 * the buyer can come back with a history wallet (Bring your history) or once
 * the account has a history of its own.
 *
 * A declined file is reported even when it is thin: `declined` shuts the
 * unsecured line for good and burns the history wallet (it can never back
 * another account), which is the point of the sybil and liquidation checks.
 *
 * Pure, so the WASM runtime runs it and the tests hold it to the mirror.
 */

import { scoreBreakdown } from "@polarispay/underwriting/core";

export interface ThinCheckFacts {
  walletAgeDays: number;
  txCount: number;
  stableBalance: bigint;
  defiTenureDays: number;
  priorLiquidations: number;
  relatedWallets: number;
  exchangeFunded: boolean;
}

/** Why these facts are a thin file the DON will not attest, or null when they may be reported. */
export function thinFileReason(facts: ThinCheckFacts): string | null {
  const b = scoreBreakdown(facts);
  if (b.declined) return null;
  if (b.age + b.activity + b.defi + b.exchange > 0) return null;
  return (
    "thin file: nothing a new account could not show (under 30 days old, under 25 sends, no DeFi history, " +
    "not funded from an exchange; a balance can be moved from account to account, so it does not count). " +
    "No report, so the account stays unscored and can come back with a history wallet or use collateral"
  );
}
