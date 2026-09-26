"use client";

import { useId, useState } from "react";
import { ActivityList } from "@/components/activity-list";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { TabBarSpacer } from "@/components/tab-bar";
import { TabHeader } from "@/components/tab-header";
import { Card, CardTitle, cx, Skeleton } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { type ActivityItem, getActivity } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { dayLabel } from "@/lib/dates";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "in", label: "Money in" },
  { id: "out", label: "Money out" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

function groupByDay(items: ActivityItem[]): Array<{ label: string; items: ActivityItem[] }> {
  const groups: Array<{ label: string; items: ActivityItem[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function Activity() {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const activity = useData(() => getActivity(owner), [owner]);
  const [filter, setFilter] = useState<Filter>("all");
  const filterLabel = useId();

  const items = activity.value?.filter((i) => filter === "all" || i.direction === filter) ?? [];
  const groups = groupByDay(items);

  return (
    <main id="main" className="px-[15px]">
      <TabHeader title="Activity" right={<HelpButton />} />

      <div role="radiogroup" aria-labelledby={filterLabel} className="mt-[21px] flex gap-[8.5px]">
        <span id={filterLabel} className="sr-only">
          Show
        </span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx(
              "press h-10 rounded-full px-[15px] text-[16px] tracking-[-0.02em]",
              filter === f.id ? "bg-chip text-on-chip" : "bg-surface text-fg shadow-surface",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-[13.5px] flex flex-col gap-[13.5px]">
        {activity.value === undefined ? (
          <Card className="px-4 pt-4 pb-2">
            <Skeleton className="h-[18px] w-20" />
            <div className="mt-[7.25px]">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex h-[70.5px] items-center gap-[14.5px]">
                  <Skeleton className="size-14 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </Card>
        ) : groups.length === 0 ? (
          <Card className="px-5 pt-6 pb-5 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-well text-[#77797c]">
              <Icon name="navActivity" size={26} strokeWidth={1.5} />
            </span>
            <p className="mt-3 text-[16px] font-medium tracking-[-0.03em]">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-[32ch] text-[14px] tracking-[-0.02em] text-meta">
              Payments, links and instalments show up the moment they happen.
            </p>
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.label} aria-label={group.label} className="px-4 pt-4 pb-2">
              <CardTitle>{group.label}</CardTitle>
              <div className="mt-[7.25px]">
                <ActivityList items={group.items} withTime />
              </div>
            </Card>
          ))
        )}
      </div>

      <TabBarSpacer />
    </main>
  );
}
