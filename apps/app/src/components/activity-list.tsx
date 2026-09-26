"use client";

import { useState } from "react";
import type { ActivityItem, CountryCode } from "@/lib/data";
import { shortDate, time } from "@/lib/dates";
import { Avatar } from "./avatar";
import type { IconName } from "./icon";
import { SignedAmount } from "./money";
import { ReceiptSheet } from "./receipt-sheet";

/** The outline glyph in a merchant's or Polaris's grey well. */
const KIND_ICON: Record<ActivityItem["kind"], IconName> = {
  payment: "bag",
  instalment: "calendar",
  "plan-opened": "calendar",
  subscription: "repeat",
  "sent-link": "link",
  sent: "send",
  received: "receive",
  claimed: "receive",
  refund: "receive",
  added: "plus",
};

/**
 * One row of history, as the reference draws it: a 56px circle, the name,
 * what it was and when underneath, and the signed amount on the right.
 * `withTime` swaps the date for the time, for lists already grouped by day.
 */
export function ActivityRow({
  item,
  onOpen,
  withTime,
}: {
  item: ActivityItem;
  onOpen: (item: ActivityItem) => void;
  withTime?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="press -mx-2 flex h-[70.5px] w-[calc(100%+16px)] items-center gap-[14.5px] rounded-[18px] px-2 text-left hover:bg-fg/[0.025]"
      >
        <Avatar
          name={item.counterparty.name}
          kind={item.counterparty.kind}
          country={item.counterparty.country as CountryCode | undefined}
          icon={KIND_ICON[item.kind]}
          size={56}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{item.title}</span>
          <span className="mt-[3px] block truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">
            {item.detail} · {withTime ? time(item.at) : shortDate(item.at)}
          </span>
        </span>
        <SignedAmount amount={item.amount} direction={item.direction} className="text-[16px] font-medium tracking-[-0.03em]" />
      </button>
    </li>
  );
}

export function ActivityList({ items, withTime }: { items: ActivityItem[]; withTime?: boolean }) {
  const [open, setOpen] = useState<ActivityItem | null>(null);
  return (
    <>
      <ul className="flex flex-col">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onOpen={setOpen} withTime={withTime} />
        ))}
      </ul>
      <ReceiptSheet item={open} onClose={() => setOpen(null)} />
    </>
  );
}
