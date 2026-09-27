"use client";

import type { ReactNode } from "react";
import { DEMO_MODE } from "@/lib/api";
import { receiptUrl } from "@/lib/chain";
import type { ActivityItem } from "@/lib/data";
import { longDate, time } from "@/lib/dates";
import { usd } from "@/lib/money";
import { Icon } from "./icon";
import { LocalEquivalent } from "./money";
import { Sheet } from "./sheet";
import { cx } from "./ui";

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  payment: "Paid in full",
  instalment: "Instalment",
  "plan-opened": "Pay in 4",
  subscription: "Subscription",
  "sent-link": "Sent by link",
  sent: "Sent",
  received: "Received",
  claimed: "Received by link",
  refund: "Returned",
  added: "Added money",
};

export function ReceiptRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="divide-y divide-divider rounded-card bg-surface px-[16.5px] shadow-surface">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-center justify-between gap-4 py-3 text-[15px] tracking-[-0.02em]">
          <dt className="text-meta">{term}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A receipt, and the one road to the explorer: "View receipt". */
export function ReceiptSheet({ item, onClose }: { item: ActivityItem | null; onClose: () => void }) {
  return (
    <Sheet open={item !== null} onClose={onClose} title={item ? item.title : "Receipt"}>
      {item ? (
        <div>
          <p
            className={cx(
              "tabular font-display text-[40px] font-bold tracking-[-0.045em]",
              item.direction === "in" ? "text-positive" : "text-fg",
            )}
          >
            {item.direction === "in" ? "+" : "−"}
            {usd(item.amount)}
          </p>
          <LocalEquivalent amount={item.amount} className="text-[15px]" />
          <div className="mt-5">
            <ReceiptRows
              rows={[
                ["What", item.detail],
                ["Type", KIND_LABEL[item.kind]],
                ["When", `${longDate(item.at)}, ${time(item.at)}`],
                ["Status", item.status === "settled" ? "Complete" : "Processing"],
              ]}
            />
          </div>
          {DEMO_MODE ? null : (
            <a
              href={receiptUrl(item.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="press mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-pill text-[15px] font-medium text-fg"
            >
              View receipt
              <Icon name="external" size={18} />
            </a>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
