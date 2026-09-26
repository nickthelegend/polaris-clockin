"use client";

import { useState } from "react";
import type { ActivityItem, CountryCode } from "@/lib/data";
import { shortDate } from "@/lib/dates";
import { Avatar } from "./avatar";
import { SignedAmount } from "./money";
import { ReceiptSheet } from "./receipt-sheet";
import type { IconName } from "./icon";

const POLARIS_ICON: Partial<Record<ActivityItem["kind"], IconName>> = {
  added: "plus",
  "sent-link": "link",
  refund: "receive",
};

/** One row of history: who, what and when, and the amount with its sign. */
export function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="press -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-[18px] px-2 py-2.5 text-left hover:bg-fg/[0.03]"
      >
        <Avatar
          name={item.counterparty.name}
          kind={item.counterparty.kind}
          country={item.counterparty.country as CountryCode | undefined}
          icon={POLARIS_ICON[item.kind]}
          size={48}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium">{item.title}</span>
          <span className="block truncate text-[13px] text-muted">
            {item.detail} · {shortDate(item.at)}
          </span>
        </span>
        <SignedAmount amount={item.amount} direction={item.direction} className="text-[16px]" />
      </button>
    </li>
  );
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  const [open, setOpen] = useState<ActivityItem | null>(null);
  return (
    <>
      <ul className="flex flex-col">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onOpen={setOpen} />
        ))}
      </ul>
      <ReceiptSheet item={open} onClose={() => setOpen(null)} />
    </>
  );
}
