/**
 * The one function the CRE `underwrite` workflow and the Node service both
 * call: evidence in; Facts, the on-chain report, the score and the product
 * decision out.
 *
 * Pure and deterministic. It reads no clock (the caller passes DON time as
 * `observedAt`), no network and no environment, and uses nothing outside
 * ECMAScript, so it compiles to WASM with the workflow.
 *
 *   const out = underwrite({ user, observedAt, account, linked, linkVerified });
 *   if (!out.final) throw new Error(`not final: ${out.missing.join(", ")}`); // no report, the app retries
 *   runtime.report(prepareReportRequest(out.report));                       // UnderwritingReceiver's batch, one item
 */

import { encodeUnderwritingReport } from "./abi.ts";
import { FACTS_VERSION, MODEL_VERSION } from "./constants.ts";
import { decide } from "./decision.ts";
import { deriveFacts, type Derivation, type DeriveOptions } from "./facts.ts";
import { declineReasonFor, explainFacts } from "./reasons.ts";
import { scoreBreakdown, type ScoreBreakdown } from "./score.ts";
import type { Address, CreditDecision, Facts, Hex, SubjectEvidence } from "./types.ts";

export interface UnderwriteInput {
  /** The buyer's Polaris account: the address ScoreManager scores. */
  user: Address;
  /** Unix seconds. In CRE, `runtime.now()`; never the node's own clock. */
  observedAt: number | bigint;
  account: SubjectEvidence;
  linked?: SubjectEvidence | null;
  /**
   * The linked wallet's ownership signature was checked (see link.ts). A
   * linked wallet without it can be previewed but never reported.
   */
  linkVerified?: boolean;
  /** What the buyer owes on open plans, for what is available now. */
  activeDebt?: bigint;
  /** A purchase to quote, in 6-decimal base units. */
  purchase?: bigint | null;
  options?: DeriveOptions;
}

export interface UnderwriteOutcome {
  version: { facts: number; model: number };
  user: Address;
  /** Only a final outcome carries a report. */
  final: boolean;
  /** `<role>.<field>` for everything that kept it from being final. */
  missing: string[];
  facts: Facts;
  /**
   * The history wallet the report names, so the receiver can hold it to this
   * account: the linked wallet when one was given (used or excluded), null
   * for the account alone.
   */
  linkedWallet: Address | null;
  /**
   * The report UnderwritingReceiver decodes, with this one underwriting:
   * `abi.encode(uint8 2, [(user, linkedWallet, facts)])`. Null when not final.
   */
  report: Hex | null;
  breakdown: ScoreBreakdown;
  decision: CreditDecision;
  derivation: Derivation;
}

export function underwrite(input: UnderwriteInput): UnderwriteOutcome {
  const derivation = deriveFacts({
    account: input.account,
    linked: input.linked ?? null,
    observedAt: input.observedAt,
    options: input.options,
  });

  const missing = [...derivation.missing];
  if (derivation.linked && input.linkVerified !== true) missing.push("linked.ownership");
  // Ownership is never waived, not even by allowPartial: an unproven wallet is someone else's history.
  const final = derivation.final && !missing.includes("linked.ownership");

  // A linked wallet that is the account itself links nothing (deriveFacts drops it too).
  const linkedWallet = derivation.linked ? (derivation.linked.address as Address) : null;

  const breakdown = scoreBreakdown(derivation.facts);
  const reasons = explainFacts(derivation.facts, breakdown, derivation);
  const decision = decide({
    score: breakdown.score,
    declined: breakdown.declined,
    declineReason: declineReasonFor(breakdown),
    activeDebt: input.activeDebt,
    purchase: input.purchase ?? null,
    reasons,
    hasLinked: derivation.linked !== null,
    pending: final ? null : missing.every((m) => m === "linked.ownership") ? "ownership" : "checks",
  });

  return {
    version: { facts: FACTS_VERSION, model: MODEL_VERSION },
    user: input.user,
    final,
    missing,
    facts: derivation.facts,
    linkedWallet,
    report: final ? encodeUnderwritingReport([{ user: input.user, linkedWallet, facts: derivation.facts }]) : null,
    breakdown,
    decision,
    derivation,
  };
}

/**
 * Explain facts that are already on chain (from an `Underwritten` event or a
 * report), without the evidence behind them: the reasons use neutral wording
 * where the source is unknown.
 */
export function explainOnChainFacts(
  facts: Facts,
  opts: { activeDebt?: bigint; purchase?: bigint | null; hasLinked?: boolean } = {},
): { breakdown: ScoreBreakdown; decision: CreditDecision } {
  const breakdown = scoreBreakdown(facts);
  const reasons = explainFacts(facts, breakdown, {});
  const decision = decide({
    score: breakdown.score,
    declined: breakdown.declined,
    declineReason: declineReasonFor(breakdown),
    activeDebt: opts.activeDebt,
    purchase: opts.purchase ?? null,
    reasons,
    hasLinked: opts.hasLinked ?? false,
  });
  return { breakdown, decision };
}
