"use client";

import { Coin, cn, type CoinTone, Money, StatusPill, type StatusPillTone, TableName, type TableColumn } from "@polaris/ui";
import type { ReactNode } from "react";
import { ActivityAvatar } from "@/components/avatars";
import type { ActivityItem } from "@/lib/data";
import { shortDate, time } from "@/lib/dates";
import { movesBalance, n, signed, when } from "@/lib/view";

/** The status pill for a row: what kind of money it was, in ref E's tints. */
export function activityPill(item: ActivityItem): { tone: StatusPillTone; text: string } {
  if (item.status !== "settled") return { tone: "amber", text: "Processing" };
  const part = item.detail.match(/(\d+) of (\d+)/);
  switch (item.kind) {
    case "payment":
      return { tone: "lime", text: "Paid" };
    case "instalment":
      return { tone: "purple", text: part ? `Pay in 4 · ${part[1]} of ${part[2]}` : "Pay in 4" };
    case "plan-opened":
      return { tone: "purple", text: "Pay in 4 · opened" };
    case "subscription":
      return { tone: "teal", text: "Subscription" };
    case "sent-link":
      if (item.detail === "Waiting to be claimed") return { tone: "amber", text: "Link · waiting" };
      if (item.detail === "Cancelled") return { tone: "neutral", text: "Cancelled" };
      return { tone: "neutral", text: "Sent by link" };
    case "sent":
      return { tone: "neutral", text: "Sent" };
    case "received":
      return { tone: "lime", text: "Received" };
    case "claimed":
      return { tone: "lime", text: "Claimed" };
    case "refund":
      return { tone: "teal", text: "Returned" };
    case "added":
      return { tone: "lime", text: "Added" };
  }
}

export function ActivityPill({ item, size }: { item: ActivityItem; size?: "sm" | "md" }) {
  const pill = activityPill(item);
  return (
    <StatusPill tone={pill.tone} size={size}>
      {pill.text}
    </StatusPill>
  );
}

/** A row's amount: signed when it moved your dollars, plain when it didn't (a plan opening). */
export function ActivityAmount({ item, className }: { item: ActivityItem; className?: string }) {
  if (!movesBalance(item)) return <Money value={n(item.amount)} dim="none" className={cn("ui-figure text-ui-muted", className)} />;
  const v = signed(item);
  return <Money value={v} signed dim="none" className={cn("ui-figure", v > 0 && "text-ui-up", className)} />;
}

type ColumnKey = "who" | "what" | "amount" | "status" | "when";

/**
 * The activity table's columns in ref E's order (Exchange · Pair · Amount ·
 * Diff · Volume): who with a round icon, what, the amount, the status pill
 * and when. `hide` drops columns for a narrower table.
 */
export function activityColumns({ hide = [], whenStyle = "relative" }: { hide?: ColumnKey[]; whenStyle?: "relative" | "full" } = {}): TableColumn<ActivityItem>[] {
  const all: (TableColumn<ActivityItem> & { key: ColumnKey })[] = [
    {
      key: "who",
      header: "Merchant or person",
      render: (a) => <TableName icon={<ActivityAvatar item={a} size="xs" />} title={a.title} />,
    },
    {
      key: "what",
      header: "What",
      hideBelow: "xl",
      render: (a) => (
        <span className="block max-w-[240px] truncate" title={a.detail}>
          {a.detail}
        </span>
      ),
    },
    { key: "amount", header: "Amount", render: (a) => <ActivityAmount item={a} /> },
    { key: "status", header: "Status", render: (a) => <ActivityPill item={a} /> },
    {
      key: "when",
      header: "When",
      align: "right",
      render: (a) => (
        <span className="ui-figure whitespace-nowrap text-ui-text" title={`${shortDate(a.at)}, ${time(a.at)}`}>
          {whenStyle === "full" ? `${shortDate(a.at)}, ${time(a.at)}` : when(a.at)}
        </span>
      ),
    },
  ];
  return all.filter((c) => !hide.includes(c.key));
}

/** A page's coin: a flat colour with a white icon, like the reference's ETH coin. */
export function PageCoin({ tone, children, size = 50 }: { tone: CoinTone; children: ReactNode; size?: number }) {
  return (
    <Coin tone={tone} size={size}>
      <span
        className="inline-grid place-items-center [&_svg]:size-full [&_svg]:stroke-[2.25]"
        style={{ width: Math.round(size * 0.46), height: Math.round(size * 0.46) }}
      >
        {children}
      </span>
    </Coin>
  );
}

/** The section title in ref E's rhythm, over a table or a row of cards. */
export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-[22px] leading-tight font-medium tracking-[-0.02em]">{children}</h2>
      {action}
    </div>
  );
}
