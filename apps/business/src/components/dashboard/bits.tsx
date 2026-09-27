"use client";

import { CopyButton, StatusPill, type StatusPillTone } from "@polaris/ui";
import { ArrowUpRight } from "lucide-react";

import { explorerAddress, explorerTx } from "@/lib/chain";
import { MODE_LABEL, PLAN_STATE_LABEL, shortAddress } from "@/lib/data/format";
import type { PayMode, PaymentStatus, PayoutStatus, PlanState } from "@/lib/data/types";

/*
  Every state as one of ref E's status pills: lime (paid, done), purple (Pay
  in 4), teal (in progress, recurring), amber (retrying, at risk), red (failed).
*/

type PillSize = "sm" | "md";

const MODE_TONE: Record<PayMode, StatusPillTone> = { now: "lime", later: "purple", subscribe: "teal" };

export function ModeBadge({ mode, size = "sm" }: { mode: PayMode; size?: PillSize }) {
  return (
    <StatusPill tone={MODE_TONE[mode]} size={size}>
      {MODE_LABEL[mode]}
    </StatusPill>
  );
}

export function PaymentStatusBadge({ status, size = "sm" }: { status: PaymentStatus; size?: PillSize }) {
  return status === "succeeded" ? (
    <StatusPill tone="lime" size={size}>
      Paid
    </StatusPill>
  ) : (
    <StatusPill tone="red" size={size}>
      Failed
    </StatusPill>
  );
}

const PLAN_TONE: Record<PlanState, StatusPillTone> = { collecting: "teal", dunning: "amber", repaid: "lime", written_off: "red" };

export function PlanStateBadge({ state, size = "sm" }: { state: PlanState; size?: PillSize }) {
  return (
    <StatusPill tone={PLAN_TONE[state]} size={size}>
      {PLAN_STATE_LABEL[state]}
    </StatusPill>
  );
}

const PAYOUT_TONE: Record<PayoutStatus, StatusPillTone> = { paid: "lime", queued: "teal", failed: "red" };

export function PayoutStatusBadge({ status, size = "sm" }: { status: PayoutStatus; size?: PillSize }) {
  return (
    <StatusPill tone={PAYOUT_TONE[status]} size={size}>
      {status === "paid" ? "Paid" : status === "queued" ? "Queued" : "Failed"}
    </StatusPill>
  );
}

/** An address, shortened, with a copy button and (optionally) the explorer. */
export function Address({ value, label, explorer = true }: { value: string; label: string; explorer?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[13px]" title={value}>
        {shortAddress(value, 6, 4)}
      </span>
      <CopyButton value={value} label={label} tone="ghost" size="sm" />
      {explorer ? (
        <a
          href={explorerAddress(value)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open the ${label} in the Monad explorer`}
          title="Open in the explorer"
          className="grid size-8 place-items-center rounded-full text-ui-muted transition-colors hover:bg-ui-surface-1 hover:text-ui-lime-active"
        >
          <ArrowUpRight aria-hidden size={16} strokeWidth={1.75} />
        </a>
      ) : null}
    </span>
  );
}

/** The settling transaction, or why there isn't one to link to. */
export function TxLink({ hash, sample }: { hash: string | null; sample: boolean }) {
  if (hash) {
    return (
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-[13px] text-ui-text underline-offset-4 hover:underline"
      >
        {shortAddress(hash, 8, 6)}
        <ArrowUpRight aria-hidden size={14} strokeWidth={1.75} />
      </a>
    );
  }
  return <span className="text-ui-muted">{sample ? "Sample: no transaction" : "Not on chain yet"}</span>;
}

/** Download rows as a CSV file (quoted, with a header). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
