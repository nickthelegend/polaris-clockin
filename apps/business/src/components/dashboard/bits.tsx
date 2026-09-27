"use client";

import { Badge, CopyButton, type BadgeTone } from "@polaris/ui";
import { ArrowUpRight } from "lucide-react";

import { explorerAddress, explorerTx } from "@/lib/chain";
import { MODE_LABEL, PLAN_STATE_LABEL, shortAddress } from "@/lib/data/format";
import type { PayMode, PaymentStatus, PayoutStatus, PlanState } from "@/lib/data/types";

export function ModeBadge({ mode }: { mode: PayMode }) {
  const tone: BadgeTone = mode === "later" ? "purple" : mode === "subscribe" ? "warn" : "neutral";
  return <Badge tone={tone}>{MODE_LABEL[mode]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return status === "succeeded" ? (
    <Badge tone="up" dot>
      Paid
    </Badge>
  ) : (
    <Badge tone="down" dot>
      Failed
    </Badge>
  );
}

const PLAN_TONE: Record<PlanState, BadgeTone> = { collecting: "lime", dunning: "warn", repaid: "up", written_off: "down" };

export function PlanStateBadge({ state }: { state: PlanState }) {
  return (
    <Badge tone={PLAN_TONE[state]} dot>
      {PLAN_STATE_LABEL[state]}
    </Badge>
  );
}

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const tone: BadgeTone = status === "paid" ? "up" : status === "queued" ? "info" : "down";
  return (
    <Badge tone={tone} dot>
      {status === "paid" ? "Paid" : status === "queued" ? "Queued" : "Failed"}
    </Badge>
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
          className="grid size-8 place-items-center rounded-full text-ui-muted transition-colors hover:bg-ui-surface-2 hover:text-ui-text"
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
