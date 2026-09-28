import { ArrowUpRight, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { IconSlot } from "../lib/icon";
import { shortHash } from "./TxLink";

export type ProvenanceBadgeProps = {
  /** Who vouches for the figure beside it: "Verified by Chainlink CRE". */
  label: ReactNode;
  /** When, or what: "Oct 2, 2026". */
  meta?: ReactNode;
  /** The proof: the report's transaction on the explorer. Unlinked without it. */
  href?: string | null;
  /** The link's words ("View report"). */
  linkLabel?: string;
  /** The proof's transaction hash: shown, shortened, when there is no explorer to link to (a local chain). */
  hash?: string | null;
  icon?: ReactNode;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Where a figure came from, with a link to the proof: a lime-tinted pill
 * with a shield, the source and its date, and "View report" opening the
 * transaction. For facts a third party attested on chain (a credit line
 * written by a Chainlink CRE workflow), never for anything computed here.
 *
 * ```tsx
 * <ProvenanceBadge label="Verified by Chainlink CRE" meta="Oct 2" href={explorerUrl} linkLabel="View report" />
 * <ProvenanceBadge label="Verified by Chainlink CRE" meta="Oct 2" hash={txHash} />   // no explorer: the hash, unlinked
 * ```
 */
export function ProvenanceBadge({ label, meta, href, linkLabel = "View report", hash, icon, size = "md", className }: ProvenanceBadgeProps) {
  const body = (
    <>
      <IconSlot size={size === "sm" ? 14 : 16} className="inline-grid shrink-0 place-items-center text-ui-lime">
        {icon ?? <ShieldCheck />}
      </IconSlot>
      <span className="font-medium text-ui-text">{label}</span>
      {meta ? <span className="text-ui-muted">· {meta}</span> : null}
      {href ? (
        <span className="inline-flex items-center gap-0.5 text-ui-text underline decoration-ui-hairline-strong underline-offset-4 group-hover:decoration-current">
          {linkLabel}
          <ArrowUpRight aria-hidden size={size === "sm" ? 13 : 14} strokeWidth={1.75} />
        </span>
      ) : hash ? (
        <span className="ui-figure text-ui-muted" title={hash}>
          · {shortHash(hash)}
        </span>
      ) : null}
    </>
  );
  const classes = cn(
    "group inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full bg-ui-lime/10 font-satoshi ring-1 ring-ui-lime/22 ring-inset",
    size === "sm" ? "min-h-7 px-2.5 py-1 text-[12.5px]" : "min-h-8 px-3 py-1.5 text-[13.5px]",
    className,
  );
  if (!href) return <span className={classes}>{body}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cn(classes, "transition-colors hover:bg-ui-lime/15 focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:outline-none")}>
      {body}
      <span className="sr-only"> (opens the explorer in a new tab)</span>
    </a>
  );
}
