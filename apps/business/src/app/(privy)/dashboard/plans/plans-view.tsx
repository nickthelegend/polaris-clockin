"use client";

import {
  Avatar,
  Card,
  CellStack,
  DetailsList,
  Drawer,
  EmptyState,
  KeyValueGrid,
  Money,
  Notice,
  Skeleton,
  Tab,
  TabList,
  Table,
  Tabs,
  Ticks,
  cn,
  type TableColumn,
} from "@polaris/ui";
import { CalendarClock, Check, Clock, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Address, PlanStateBadge } from "@/components/dashboard/bits";
import { DataModeNotice, LoadError, SampleBadge, StaleNotice } from "@/components/dashboard/common";
import { DashboardHeader } from "@/components/shell/dashboard-shell";
import { formatDate, formatDue, money, PLAN_INTERVAL_DAYS } from "@/lib/data/format";
import type { Plan, PlanFilter } from "@/lib/data/types";
import { useQuery, useSample, type QueryState } from "@/lib/session";

const DAY = 86_400_000;

export function PlansView() {
  const plans = useQuery((d) => d.listPlans(), { refreshMs: 60_000 });
  const sample = useSample();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filter, setFilter] = useState<PlanFilter>("all");

  const list = plans.data;
  const openId = params.get("open");
  const openOrder = params.get("order");
  const open = list?.find((p) => (openId ? p.id === openId : openOrder ? p.orderId === openOrder : false)) ?? null;
  const setOpen = (p: Plan | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("order");
    if (p) next.set("open", p.id);
    else next.delete("open");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const counts = useMemo(() => {
    const c = { all: 0, collecting: 0, dunning: 0, closed: 0 };
    for (const p of list ?? []) {
      c.all += 1;
      if (p.state === "collecting") c.collecting += 1;
      else if (p.state === "dunning") c.dunning += 1;
      else c.closed += 1;
    }
    return c;
  }, [list]);

  const filtered = (list ?? []).filter((p) =>
    filter === "all" ? true : filter === "closed" ? p.state === "repaid" || p.state === "written_off" : p.state === filter,
  );

  return (
    <>
      <DashboardHeader
        title="Pay in 4"
        description="Every plan your buyers opened. You were paid in full when each one opened; Polaris collects the four payments and carries the risk."
      />
      <StaleNotice queries={[plans as QueryState<unknown>]} />
      <DataModeNotice empty={list !== undefined && list.length === 0} />

      <Summary plans={list} sample={sample.on} />

      <Card padding="none" className="mt-4 min-w-0">
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as PlanFilter)} variant="pill">
            <TabList aria-label="Filter plans">
              <Tab value="all" count={counts.all}>
                All
              </Tab>
              <Tab value="collecting" count={counts.collecting}>
                Collecting
              </Tab>
              <Tab value="dunning" count={counts.dunning}>
                Retrying
              </Tab>
              <Tab value="closed" count={counts.closed}>
                Closed
              </Tab>
            </TabList>
          </Tabs>
        </div>

        {plans.error && !list ? (
          <LoadError query={plans as QueryState<unknown>} title="We couldn't load the ledger" />
        ) : !list ? (
          <div className="grid gap-2 p-4 sm:p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} shape="row" height={64} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title={list.length ? "No plans here" : "No Pay in 4 plans yet"}
            description={
              list.length
                ? "No plans match this filter."
                : "When a buyer chooses Pay in 4 on one of your links, the plan appears here with its four payments."
            }
          />
        ) : (
          <>
            <div className="hidden xl:block">
              <Table
                className="mt-3 pb-2"
                caption="Pay in 4 plans"
                columns={columns(sample.on)}
                rows={filtered}
                rowKey={(p) => p.id}
                onRowClick={(p) => setOpen(p)}
                selectedKey={open?.id}
              />
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:p-4 xl:hidden">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(p)}
                    className="grid w-full grid-cols-[minmax(0,1fr)] gap-3 rounded-[22px] bg-ui-surface-2 px-4 py-3.5 text-left transition-colors hover:bg-ui-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus sm:px-5"
                  >
                    <span className="flex items-center gap-3">
                      <Avatar name={p.description} size="md" decorative />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[16px] font-medium">{p.description}</span>
                          {sample.on ? <SampleBadge /> : null}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-ui-muted">
                          {p.nextDueAt ? nextPaymentLabel(p.nextDueAt) : `Opened ${formatDate(p.openedAt)}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="ui-figure block text-[15px] font-medium">{money(p.outstandingCents)}</span>
                        <span className="block text-[12px] text-ui-muted">outstanding</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <Ticks
                        done={p.installmentsPaid}
                        late={p.state === "dunning" ? 1 : 0}
                        total={p.installmentCount}
                        size="sm"
                        className="flex-1"
                      />
                      <PlanStateBadge state={p.state} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <PlanDrawer plan={open} sample={sample.on} onClose={() => setOpen(null)} />
    </>
  );
}

function columns(sample: boolean): TableColumn<Plan>[] {
  return [
    {
      key: "plan",
      header: "Plan",
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.description} size="sm" decorative />
          <CellStack
            title={
              <span className="flex items-center gap-2">
                <span className="truncate">{p.description}</span>
                {sample ? <SampleBadge /> : null}
              </span>
            }
            sub={`${p.orderId} · opened ${formatDate(p.openedAt)}`}
          />
        </div>
      ),
    },
    {
      key: "progress",
      header: "Paid",
      width: 170,
      render: (p) => (
        <div className="flex items-center gap-3">
          <Ticks done={p.installmentsPaid} late={p.state === "dunning" ? 1 : 0} total={p.installmentCount} size="sm" className="w-24" />
          <span className="ui-figure text-[13px] text-ui-muted">
            {p.installmentsPaid}/{p.installmentCount}
          </span>
        </div>
      ),
    },
    {
      key: "next",
      header: "Next payment",
      render: (p) => (
        <span className={cn("whitespace-nowrap", p.state === "dunning" ? "text-ui-warn" : "text-ui-muted")}>
          {p.nextDueAt ? formatDue(p.nextDueAt) : "—"}
          {p.state === "dunning" ? ` · retry ${p.attempts}` : ""}
        </span>
      ),
    },
    { key: "state", header: "State", render: (p) => <PlanStateBadge state={p.state} /> },
    { key: "outstanding", header: "Outstanding", align: "right", render: (p) => <span className="font-medium">{money(p.outstandingCents)}</span> },
    { key: "total", header: "Order", align: "right", render: (p) => <span className="text-ui-muted">{money(p.principalCents)}</span> },
  ];
}

function Summary({ plans, sample }: { plans?: Plan[]; sample: boolean }) {
  const s = useMemo(() => {
    if (!plans) return null;
    let outstanding = 0;
    let atRisk = 0;
    let open = 0;
    let principal = 0;
    for (const p of plans) {
      principal += p.principalCents;
      if (p.state === "collecting" || p.state === "dunning") {
        outstanding += p.outstandingCents;
        open += 1;
      }
      if (p.state === "dunning") atRisk += p.outstandingCents;
    }
    return { outstanding, atRisk, open, principal };
  }, [plans]);
  if (!s) return <Skeleton shape="tile" height={84} />;
  return (
    <div className="relative">
      <KeyValueGrid
        columns={4}
        variant="surface"
        items={[
          { label: "Paid to you up front", value: <Money value={s.principal / 100} /> },
          { label: "Still owed by buyers", value: <Money value={s.outstanding / 100} /> },
          { label: "Retrying", value: <Money value={s.atRisk / 100} /> },
          {
            label: "Open plans",
            // One Sample chip for the whole strip, beside its shortest figure.
            value: sample ? (
              <span className="flex items-center gap-2">
                {s.open.toLocaleString("en-US")}
                <SampleBadge />
              </span>
            ) : (
              s.open.toLocaleString("en-US")
            ),
          },
        ]}
      />
    </div>
  );
}

type Instalment = { index: number; dueAt: number; cents: number; status: "paid" | "due" | "retrying" | "upcoming" | "written_off" };

function schedule(p: Plan): Instalment[] {
  const opened = new Date(p.openedAt).getTime();
  const each = Math.floor(p.totalCents / p.installmentCount);
  const last = p.totalCents - each * (p.installmentCount - 1);
  return Array.from({ length: p.installmentCount }, (_, i) => {
    const index = i + 1;
    // Payment k falls due k weeks after checkout (interest runs 28 days).
    const dueAt = opened + index * PLAN_INTERVAL_DAYS * DAY;
    let status: Instalment["status"] = "upcoming";
    if (index <= p.installmentsPaid) status = "paid";
    else if (p.state === "written_off") status = "written_off";
    else if (p.state === "dunning" && index === p.installmentsPaid + 1) status = "retrying";
    else if (index === p.installmentsPaid + 1) status = "due";
    return { index, dueAt, cents: index === p.installmentCount ? last : each, status };
  });
}

const STEP = {
  paid: { icon: <Check size={15} strokeWidth={2.5} />, well: "bg-ui-lime text-ui-on-lime", label: "Paid" },
  due: { icon: <Clock size={15} strokeWidth={2} />, well: "bg-ui-surface-3 text-ui-text", label: "Next" },
  retrying: { icon: <RotateCcw size={15} strokeWidth={2} />, well: "bg-[#f5a524] text-[#2f2410]", label: "Retrying" },
  upcoming: { icon: <Clock size={15} strokeWidth={2} />, well: "bg-ui-surface-2 text-ui-muted", label: "Upcoming" },
  written_off: { icon: <X size={15} strokeWidth={2} />, well: "bg-ui-down/20 text-ui-down", label: "Written off" },
} as const;

function PlanDrawer({ plan, sample, onClose }: { plan: Plan | null; sample: boolean; onClose: () => void }) {
  const [last, setLast] = useState<Plan | null>(plan);
  if (plan && plan !== last) setLast(plan);
  const p = plan ?? last;
  return (
    <Drawer open={plan !== null} onOpenChange={(o) => !o && onClose()} title="Pay in 4 plan" description={p ? `${p.orderId} · ${p.id}` : undefined}>
      {p ? (
        <Drawer.Body>
          <div className="flex items-center gap-3 pb-5">
            <Avatar name={p.description} size="lg" decorative />
            <CellStack title={p.description} sub={`Opened ${formatDate(p.openedAt, true)}`} />
            {sample ? <SampleBadge className="ml-auto" /> : null}
          </div>
          <p className="text-[14px] text-ui-muted">Still owed</p>
          <Money value={p.outstandingCents / 100} className="text-[44px] leading-none font-semibold tracking-[-0.035em]" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PlanStateBadge state={p.state} />
            <Ticks done={p.installmentsPaid} late={p.state === "dunning" ? 1 : 0} total={p.installmentCount} className="w-32" />
          </div>
          <KeyValueGrid
            className="mt-6"
            items={[
              { label: "Paid to you up front", value: money(p.principalCents) },
              { label: "The buyer repays", value: money(p.totalCents) },
              { label: "Interest (buyer's)", value: money(p.totalCents - p.principalCents) },
              { label: "Your risk", value: "$0.00" },
            ]}
          />
          <h3 className="mt-6 text-[16px] font-medium">Schedule</h3>
          <ol className="mt-3 grid gap-2">
            {schedule(p).map((s) => {
              const step = STEP[s.status];
              return (
                <li key={s.index} className="flex items-center gap-3 rounded-ui-row bg-ui-surface-2 px-4 py-3">
                  <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full", step.well)}>
                    {step.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">Payment {s.index} of {p.installmentCount}</span>
                    <span className="block text-[13px] text-ui-muted">
                      {step.label} · {formatDate(new Date(s.dueAt).toISOString(), true)}
                    </span>
                  </span>
                  <span className="ui-figure text-[15px] font-medium">{money(s.cents)}</span>
                </li>
              );
            })}
          </ol>
          {p.state === "dunning" ? (
            <Notice tone="warn" size="sm" className="mt-4" title={`Collection retrying (attempt ${p.attempts})`}>
              The buyer&rsquo;s account didn&rsquo;t cover the payment. Polaris retries after 6 hours, a day and three days, and
              reminds the buyer each time. Your payout isn&rsquo;t affected.
            </Notice>
          ) : null}
          <DetailsList
            className="mt-4"
            size="sm"
            items={[
              { label: "Buyer", value: <Address value={p.buyer} label="buyer's address" explorer={!sample} /> },
              { label: "Order", value: p.orderId },
              { label: "Collected by", value: "Chainlink CRE, every minute" },
            ]}
          />
        </Drawer.Body>
      ) : null}
    </Drawer>
  );
}

/** "Next payment in 5 days", "Next payment tomorrow", "Payment 2 days overdue", "Next payment on Oct 12". */
function nextPaymentLabel(iso: string): string {
  const due = formatDue(iso);
  if (due.endsWith("overdue")) return `Payment ${due}`;
  if (/^(In|Today|Tomorrow)\b/.test(due)) return `Next payment ${due[0]!.toLowerCase()}${due.slice(1)}`;
  return `Next payment on ${due}`;
}
