/**
 * Whether the DON may attest a set of facts at all: the thin-file gate.
 *
 * ScoreManager opens every underwritten wallet at UNDERWRITE_FLOOR (520, the
 * $200 tier) and adds what the facts earn, and PolarisLoanEngine lends against
 * that line unsecured. So a report for an account with no history is a free
 * $200 line: one person could open many free accounts, underwrite each one,
 * and draw about $196 from every one, and liquidation would seize nothing.
 * The security review proved it on a Hardhat chain through
 * UnderwritingReceiver with requireUnderwriting on (all facts 0: score 520,
 * creditLimitOf $200). The sybil and one-link checks cover only a linked
 * history wallet, so they do not help an account that brings none.
 *
 * So the DON attests only facts that show something a brand-new account
 * cannot: at least one point from a signal that takes time or a real identity
 * to earn, in ScoreManager's own step sizes (`scoreFromFacts`). Any one of
 *
 *   walletAgeDays   >= 30   (2 points per 30 days)
 *   txCount         >= 25   (1 point per 25 payments and transfers)
 *   defiTenureDays  >= 30   (1 point per 30 days)
 *   exchangeFunded          (10 points: an exchange's identity checks stand behind it)
 *
 * counted across every subject the derivation used (the account, plus a
 * linked wallet that passed its risk checks). Dollars do not count: the same
 * balance can be walked through account after account inside the 15 minutes
 * a report is good for.
 *
 * A thin file gets no report at all, rather than a report of zeros. The
 * account stays where `requireUnderwriting` puts every account before its
 * report, exactly as `ScoreManager._securedOnly` treats it: no unsecured
 * line, collateral at face value. Because underwriting runs once per account,
 * that also keeps the door open: the buyer comes back with a history wallet
 * (Bring your history, which clears the gate at once) or once the account has
 * a history of its own.
 *
 * A declined file is attested even when it is thin: `declined` shuts the
 * unsecured line for good and spends the history wallet (it can never back
 * another account), which is the point of the sybil and liquidation checks.
 *
 * This is the same rule, point for point, as the CRE underwriting workflow's
 * gate (workflows/src/underwriting/thin.ts on metropolis/cre), so the app's
 * preview never promises a line the DON will not attest, or hides one it will.
 * A matching floor in `ScoreManager.underwrite` belongs to the contracts.
 */

import { ATTEST_MINIMUM } from "./constants.ts";
import { scoreBreakdown } from "./score.ts";
import type { AttestGap, Facts } from "./types.ts";

export type { AttestGap };

type GateFacts = Omit<Facts, "observedAt"> & { observedAt?: bigint };

/** True when the DON may attest these facts: declined, or at least one point from time or identity. */
export function isAttestable(facts: GateFacts): boolean {
  const b = scoreBreakdown(facts);
  return b.declined || b.age + b.activity + b.defi + b.exchange > 0;
}

/**
 * Empty when the facts may be attested. Otherwise the facts are a thin file,
 * and each entry is one way out: reaching any single `need` clears the gate
 * (as does a history wallet first funded from an exchange).
 */
export function attestGaps(facts: GateFacts): AttestGap[] {
  if (isAttestable(facts)) return [];
  return [
    { fact: "walletAgeDays", have: facts.walletAgeDays, need: ATTEST_MINIMUM.walletAgeDays },
    { fact: "txCount", have: facts.txCount, need: ATTEST_MINIMUM.txCount },
    { fact: "defiTenureDays", have: facts.defiTenureDays, need: ATTEST_MINIMUM.defiTenureDays },
  ];
}
