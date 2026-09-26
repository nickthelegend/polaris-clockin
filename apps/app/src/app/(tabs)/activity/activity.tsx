"use client";

import { useId, useState } from "react";
import { ActivityList } from "@/components/activity-list";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { TabBarSpacer } from "@/components/tab-bar";
import { TabHeader } from "@/components/tab-header";
import { Card, cx, Skeleton } from "@/components/ui";
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
    <main id="main" className="px-4 pt-[calc(env(safe-area-inset-top)+14px)]">
      <TabHeader title="Activity" right={<HelpButton />} />

      <div role="radiogroup" aria-labelledby={filterLabel} className="mt-5 flex gap-2">
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
              "press h-9 rounded-full px-4 text-[14px] font-medium",
              filter === f.id ? "bg-chip text-on-chip" : "bg-surface text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {activity.value === undefined ? (
          <Card className="space-y-4 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </Card>
        ) : groups.length === 0 ? (
          <Card className="p-6 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-pill">
              <Icon name="activity" size={22} />
            </span>
            <p className="mt-3 text-[16px] font-medium">Nothing here yet</p>
            <p className="mt-1 text-[14px] text-muted">Payments, links and instalments show up the moment they happen.</p>
          </Card>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-2 px-1 text-[14px] font-medium text-muted">{group.label}</h2>
              <Card className="px-4 py-1.5">
                <ActivityList items={group.items} />
              </Card>
            </section>
          ))
        )}
      </div>

      <TabBarSpacer />
    </main>
  );
}
