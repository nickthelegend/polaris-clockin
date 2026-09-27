/**
 * Whether the DON may attest a set of facts at all: the evidence floor.
 *
 * ScoreManager opens every underwritten wallet at UNDERWRITE_FLOOR (520, the
 * $200 tier) whatever the facts say, and PolarisLoanEngine lends against that
 * line unsecured. So a report for an account with no history is a free $200
 * line: one person could open many free accounts, underwrite each one, and
 * draw about $196 from every one, and liquidation would seize nothing. The
 * security review proved it on a Hardhat chain through UnderwritingReceiver
 * with requireUnderwriting on (all facts 0: score 520, creditLimitOf $200).
 * The sybil and one-link checks cover only a linked history wallet, so they
 * do not help an account that brings none.
 *
 * The fix, on the package's side, is that the workflow does not attest a thin
 * file. Facts are thin when they show less than `ATTEST_MINIMUM`: under a
 * month of history, or fewer than five payments and transfers, counted across
 * every subject the derivation used (the account, plus a linked wallet whose
 * ownership and risk checks passed). Below it there is no report. The account
 * stays not underwritten, which while `ScoreManager.requireUnderwriting` is on
 * means secured-only, exactly as `_securedOnly` treats it: collateral counts
 * at face value and nothing unsecured opens.
 *
 * Declining to attest also keeps the door open. Underwriting runs once per
 * account, so a report for today's empty account would fix it at the floor;
 * with no report, the same account is underwritten later, once it has the
 * history or links a wallet that does. A decline is not attested either: a
 * thin file that also declines stays secured-only, which is what a declined
 * wallet gets anyway, without spending the one underwriting.
 *
 * Age and activity, not balance: a balance is a snapshot that one person can
 * move through every account in turn, while a month of age cannot be
 * borrowed. A linked wallet's age and activity are on mainnets (real gas, and
 * Nansen's cluster check), so bringing a real history clears the floor at
 * once, which is the product's "Bring your history" step.
 *
 * The contract does not enforce this yet: a DON that attested a thin file
 * would still open the floor line. A matching floor in
 * `ScoreManager.underwrite` belongs to the contracts (see the README).
 */

import { ATTEST_MINIMUM } from "./constants.ts";
import type { AttestGap, Facts } from "./types.ts";

export type { AttestGap };

/** What keeps these facts from being attested; empty when they clear the floor. */
export function attestGaps(facts: Pick<Facts, "walletAgeDays" | "txCount">): AttestGap[] {
  const gaps: AttestGap[] = [];
  if (facts.walletAgeDays < ATTEST_MINIMUM.walletAgeDays) {
    gaps.push({ fact: "walletAgeDays", have: facts.walletAgeDays, need: ATTEST_MINIMUM.walletAgeDays });
  }
  if (facts.txCount < ATTEST_MINIMUM.txCount) {
    gaps.push({ fact: "txCount", have: facts.txCount, need: ATTEST_MINIMUM.txCount });
  }
  return gaps;
}

/** True when the facts clear the evidence floor, so the DON may attest them. */
export function isAttestable(facts: Pick<Facts, "walletAgeDays" | "txCount">): boolean {
  return attestGaps(facts).length === 0;
}
