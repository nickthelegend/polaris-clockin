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
 * So the DON attests only facts that show a life elsewhere, exactly as
 * `ScoreManager.isThinFile` requires on chain (the report would be refused
 * with ThinFile otherwise): at least 90 days since the oldest activity AND at
 * least 10 transactions, over the account and the wallet it linked. Age is
 * the signal a farmer cannot parallelise; the transaction floor stops an old
 * wallet funded once and never used from standing in for a history.
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
/** ScoreManager.MIN_HISTORY_DAYS and MIN_HISTORY_TXS. */
export const MIN_HISTORY_DAYS = 90;
export const MIN_HISTORY_TXS = 10;

export function thinFileReason(facts: ThinCheckFacts): string | null {
  const b = scoreBreakdown(facts);
  if (b.declined) return null;
  if (facts.walletAgeDays >= MIN_HISTORY_DAYS && facts.txCount >= MIN_HISTORY_TXS) return null;
  return (
    `thin file: ${facts.walletAgeDays} days and ${facts.txCount} transactions of history, under ScoreManager's ` +
    `${MIN_HISTORY_DAYS} days and ${MIN_HISTORY_TXS} transactions (isThinFile; a balance can be moved from account to account, ` +
    "so it does not count). No report, so the account stays unscored and can come back with a history wallet or use collateral"
  );
}
