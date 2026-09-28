"use client";

import { ProvenanceBadge } from "@polaris/ui";
import type { CreditLine } from "@/lib/data/types";
import { shortDate } from "@/lib/dates";

/**
 * "Verified by Chainlink CRE · Oct 2 · View report": the line and score came
 * from a report the Chainlink CRE underwriting workflow wrote on chain, and
 * this links to that transaction. Nothing when there is no such report (a
 * new account, or the offline demo's sample line, which nobody attested).
 */
export function CreditProvenance({ credit, size, className }: { credit: CreditLine | undefined; size?: "sm" | "md"; className?: string }) {
  const v = credit?.verified;
  if (!v) return null;
  return <ProvenanceBadge label="Verified by Chainlink CRE" meta={shortDate(v.at)} href={v.explorerUrl} hash={v.txHash} linkLabel="View report" size={size} className={className} />;
}
