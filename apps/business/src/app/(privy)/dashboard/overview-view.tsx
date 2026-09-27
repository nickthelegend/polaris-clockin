"use client";

import {
  Avatar,
  BarChart,
  Button,
  CandlestickChart,
  DonutChart,
  Money,
  ProgressLegend,
  Skeleton,
  StatCard,
  TxRow,
  cn,
  useMediaQuery,
} from "@polaris/ui";
import {
  Activity,
  BadgeCheck,
  CalendarClock,
  CandlestickChart as CandlesIcon,
  Landmark,
  Layers,
  Percent,
  Plus,
  Radio,
  ShieldCheck,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DataModeNotice, Panel, PanelEmpty, SampleBadge, SeeAll, StaleNotice, useNow, LoadError } from "@/components/dashboard/common";
import { DashboardHeader, greeting } from "@/components/shell/dashboard-shell";
import { averageClose, customersThisWeek, salesByMode, salesSummary, volumeCandles, type VolumeFrame } from "@/lib/data/analytics";
import { formatAgo, MODE_LABEL, money, shortAddress } from "@/lib/data/format";
import {
  getCollectionsRun,
  getIndexedEvents,
  getUnderwritingReasons,
  placeholderNextEvent,
  type IndexedEvent,
} from "@/lib/data/insights";
import type { Overview, Payment, Plan } from "@/lib/data/types";
import { useMerchant } from "@/lib/merchant-context";
import { useQuery, useSample, type QueryState } from "@/lib/session";

const MODE_COLOR = { now: "var(--ui-teal)", later: "var(--ui-pink)", subscribe: "var(--ui-honey)" } as const;

export function OverviewView() {
  const { merchant } = useMerchant();
  const sample = useSample();
  const overview = useQuery((d) => d.getOverview(), { refreshMs: 30_000 });
  const payments = useQuery((d) => d.listPayments(), { refreshMs: 30_000 });
  const plans = useQuery((d) => d.listPlans(), { refreshMs: 60_000 });

  const list = payments.data;
  const empty = overview.data !== undefined && list !== undefined && list.length === 0 && overview.data.balanceCents === 0;

  return (
    <>
      <DashboardHeader
        eyebrow={`${greeting()}, ${merchant.businessName}`}
        title="Overview"
        actions={
          <>
            <Button asChild variant="outline" size="md" icon={<Landmark />}>
              <Link href="/dashboard/payouts">Withdraw</Link>
            </Button>
            <Button asChild variant="lime" size="md" icon={<Plus />}>
              <Link href="/dashboard/links?new=1">New link</Link>
            </Button>
          </>
        }
      />
      <StaleNotice queries={[overview, payments, plans] as QueryState<unknown>[]} />
      <DataModeNotice empty={empty} />

      <StatRow overview={overview.data} payments={list} loading={!overview.data || !list} sample={sample.on} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <CustomersPanel payments={list} error={payments.error && !list ? payments : null} sample={sample.on} className="xl:col-span-5" />
        <ModesPanel payments={list} sample={sample.on} className="xl:col-span-7" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <VolumePanel payments={list} sample={sample.on} className="xl:col-span-8" />
        <RecentSales payments={list} sample={sample.on} className="xl:col-span-4" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ExposurePanel overview={overview.data} plans={plans.data} sample={sample.on} />
        <CollectionsPanel plans={plans.data} sample={sample.on} />
        <EnvioFeed payments={list} plans={plans.data} sample={sample.on} className="lg:col-span-2 xl:col-span-1" />
      </div>
    </>
  );
}

/* ── The four stat cards ────────────────────────────────────────────────── */

function StatRow({ overview, payments, loading, sample }: { overview?: Overview; payments?: Payment[]; loading: boolean; sample: boolean }) {
  const all = useMemo(() => (payments ? salesSummary(payments, { days: 30 }) : null), [payments]);
  const later = useMemo(() => (payments ? salesSummary(payments, { days: 30, mode: "later" }) : null), [payments]);
  const subs = useMemo(() => (payments ? salesSummary(payments, { days: 30, mode: "subscribe" }) : null), [payments]);
  if (loading || !overview || !all || !later || !subs) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} shape="card" height={184} />
        ))}
      </div>
    );
  }
  const foot = (text: string) =>
    sample ? (
      <span className="flex items-center gap-2">
        <SampleBadge className="bg-black/10 text-[#13141f]" />
        <span className="truncate">{text}</span>
      </span>
    ) : (
      text
    );
  const delta = (d: number | null) => (d === null ? undefined : Math.round(d));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        tone="sage"
        icon={<Percent />}
        label="Sales"
        delta={delta(all.deltaPct)}
        value={<Money value={all.grossCents / 100} decimals={0} spaced dim="none" />}
        spark={all.spark.slice(-14)}
        footer={foot(`${all.count} ${all.count === 1 ? "payment" : "payments"} in 30 days`)}
      />
      <StatCard
        tone="pink"
        icon={<Layers />}
        label="Pay in 4"
        delta={delta(later.deltaPct)}
        value={<Money value={later.grossCents / 100} decimals={0} spaced dim="none" />}
        spark={later.spark.slice(-14)}
        footer={foot("Paid to you in full at checkout")}
      />
      <StatCard
        tone="honey"
        icon={<CalendarClock />}
        label="Subscriptions"
        delta={delta(subs.deltaPct)}
        value={<Money value={subs.grossCents / 100} decimals={0} spaced dim="none" />}
        spark={subs.spark.slice(-14)}
        footer={foot("Charged in the last 30 days")}
      />
      <StatCard
        tone="surface"
        icon={<Wallet />}
        label={
          <span className="flex items-center gap-2">
            Balance
            {sample ? <SampleBadge /> : null}
          </span>
        }
        value={<Money value={overview.balanceCents / 100} />}
        footer={
          <span className="flex flex-col gap-3">
            <span>Dollars (AUSD) in your payout account</span>
            <Link
              href="/dashboard/payouts"
              className="inline-flex h-10 items-center justify-center rounded-full bg-ui-surface-2 px-4 text-[14px] font-medium text-ui-text transition-colors hover:bg-ui-surface-3"
            >
              Go to payouts
            </Link>
          </span>
        }
      />
    </div>
  );
}

/* ── Customers this week (ref D bars) ───────────────────────────────────── */

function CustomersPanel({ payments, error, sample, className }: { payments?: Payment[]; error: QueryState<Payment[]> | null; sample: boolean; className?: string }) {
  const week = useMemo(() => (payments ? customersThisWeek(payments) : null), [payments]);
  return (
    <Panel
      title="Customers this week"
      sample={sample}
      action={<SeeAll href="/dashboard/payments" />}
      className={className}
    >
      {error ? (
        <LoadError query={error as QueryState<unknown>} />
      ) : !week ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : week.total === 0 ? (
        <PanelEmpty icon={<Users />} title="No buyers yet this week" description="Each bar is the people who paid you that day." />
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="ui-figure text-[40px] leading-none font-bold tracking-[-0.03em]">
              {week.deltaPct === null ? week.total : `${week.deltaPct >= 0 ? "+" : "−"} ${Math.abs(week.deltaPct).toFixed(1)}%`}
            </span>
            <span className="text-[14px] text-ui-muted">
              {week.total} {week.total === 1 ? "buyer" : "buyers"}
              {week.deltaPct === null ? " this week" : " vs last week"}
            </span>
          </div>
          <BarChart
            className="mt-6"
            label="Buyers per day this week"
            data={week.days.map((d) => ({ label: d.label, value: d.value }))}
            defaultSelected={week.days.findIndex((d) => d.today)}
            height={300}
            formatValue={(v) => `${v} ${v === 1 ? "buyer" : "buyers"}`}
            formatTick={(v) => String(Math.round(v))}
          />
        </>
      )}
    </Panel>
  );
}

/* ── Sales by mode (ref D donut) ────────────────────────────────────────── */

function ModesPanel({ payments, sample, className }: { payments?: Payment[]; sample: boolean; className?: string }) {
  const split = useMemo(() => (payments ? salesByMode(payments, { days: 30 }) : null), [payments]);
  const total = split?.reduce((s, m) => s + m.cents, 0) ?? 0;
  return (
    <Panel title="Sales by mode" subtitle={split ? `Last 30 days · ${money(total)}` : "Last 30 days"} sample={sample} className={className}>
      {!split ? (
        <Skeleton shape="tile" height={280} className="mt-5" />
      ) : total === 0 ? (
        <PanelEmpty icon={<Layers />} title="No sales in the last 30 days" description="Pay now, Pay in 4 and subscriptions split here once buyers pay." />
      ) : (
        // Ref D: the donut centred, the legend in three columns beneath it.
        <div className="mt-4 flex flex-col items-center gap-7">
          <DonutChart
            label="Sales by payment mode, last 30 days"
            size={264}
            data={split.map((m) => ({ label: MODE_LABEL[m.mode], value: m.cents / 100, color: MODE_COLOR[m.mode] }))}
            formatValue={(v) => `$${Math.round(v).toLocaleString("en-US")}`}
            centerLabel="Total"
            centerValue={`$${Math.round(total / 100).toLocaleString("en-US")}`}
            className="shrink-0"
          />
          <ProgressLegend
            className="w-full min-w-0"
            items={split.map((m) => ({ label: MODE_LABEL[m.mode], value: m.share, color: MODE_COLOR[m.mode] }))}
          />
        </div>
      )}
    </Panel>
  );
}

/* ── Daily payment volume (ref C candles) ───────────────────────────────── */

function VolumePanel({ payments, sample, className }: { payments?: Payment[]; sample: boolean; className?: string }) {
  const [frame, setFrame] = useState<VolumeFrame>("1M");
  // A phone fits about 14 readable candles: show the most recent ones.
  const narrow = useMediaQuery("(max-width: 639px)");
  const candles = useMemo(() => {
    if (!payments) return null;
    const all = volumeCandles(payments, frame);
    return narrow ? all.slice(-14) : all;
  }, [payments, frame, narrow]);
  const hasVolume = candles?.some((c) => c.h > 0) ?? false;
  const fmt = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`);

  if (!candles) return <Skeleton shape="card" height={420} className={className} />;
  if (!hasVolume) {
    return (
      <Panel title="Payment volume" subtitle="Rolling 24 hours, in dollars" sample={sample} className={className}>
        <PanelEmpty icon={<CandlesIcon />} title="No volume to chart yet" description="Each candle is a day of payments: lime when the last 24 hours beat the day before." />
      </Panel>
    );
  }
  return (
    <div className={cn("relative min-w-0", className)}>
      <CandlestickChart
        label={`Payment volume, rolling 24 hours in dollars, ${frame === "1W" ? "6-hour" : frame === "1M" ? "daily" : "3-day"} candles`}
        data={candles.map((c) => ({ ...c, t: c.t }))}
        height={420}
        reference={{ value: averageClose(candles), label: `avg ${fmt(averageClose(candles))}` }}
        timeframes={["1W", "1M", "3M"]}
        timeframe={frame}
        onTimeframeChange={(tf) => setFrame(tf as VolumeFrame)}
        formatPrice={fmt}
        formatTime={(t) =>
          new Date(t).toLocaleString("en-US", frame === "1W" ? { weekday: "short", hour: "numeric" } : { month: "short", day: "numeric" })
        }
        leading={
          <span className="flex items-center gap-2 px-2 text-[15px] font-medium whitespace-nowrap">
            Payment volume
            {sample ? <SampleBadge /> : null}
          </span>
        }
        className="rounded-ui-card"
      />
    </div>
  );
}

/* ── Recent sales (ref D rows) ──────────────────────────────────────────── */

function RecentSales({ payments, sample, className }: { payments?: Payment[]; sample: boolean; className?: string }) {
  const router = useRouter();
  const now = useNow(30_000);
  const recent = payments?.slice(0, 5) ?? [];
  return (
    <Panel title="Recent sales" sample={sample} action={<SeeAll href="/dashboard/payments" />} className={className}>
      {!payments ? (
        <div className="mt-5 grid gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} shape="row" height={64} />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <PanelEmpty icon={<Activity />} title="No sales yet" description="Your latest payments land here the second they settle." />
      ) : (
        <div className="mt-5 grid gap-2.5">
          {recent.map((p) => (
            <TxRow
              key={p.id}
              variant="card"
              leading={<Avatar name={p.description} size="md" decorative />}
              title={p.description}
              subtitle={`${MODE_LABEL[p.mode]} · ${formatAgo(p.createdAt, now)}`}
              value={
                p.status === "failed" ? (
                  <span className="text-ui-muted line-through">{money(p.amountCents)}</span>
                ) : (
                  <Money value={p.amountCents / 100} signed dim="none" className="text-ui-up" />
                )
              }
              subAmount={p.status === "failed" ? "Failed" : undefined}
              onClick={() => router.push(`/dashboard/payments?open=${encodeURIComponent(p.id)}`)}
              aria-label={`${p.description}, ${money(p.amountCents)}, ${MODE_LABEL[p.mode]}, ${formatAgo(p.createdAt, now)}. Open the payment.`}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── Credit exposure, with the reasons behind the lines (Nansen) ────────── */

function ExposurePanel({ overview, plans, sample }: { overview?: Overview; plans?: Plan[]; sample: boolean }) {
  const e = overview?.exposure;
  const reasons = useMemo(() => (plans ? getUnderwritingReasons({ sample, plans }) : null), [plans, sample]);
  return (
    <Panel title="Credit exposure" subtitle="Pay in 4 plans still collecting" sample={sample} action={<SeeAll href="/dashboard/plans">Ledger</SeeAll>}>
      {!e || !reasons ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Figure label="Outstanding" value={money(e.outstandingCents)} note={`${e.collectingPlans + e.atRiskPlans} open plans`} />
            <Figure
              label="At risk"
              value={money(e.atRiskCents)}
              note={e.atRiskPlans ? `${e.atRiskPlans} retrying` : "Nothing retrying"}
              tone={e.atRiskPlans ? "warn" : undefined}
            />
            <Figure label="Collected this week" value={money(e.collectedThisWeekCents)} />
            <Figure label="On time" value={e.collectionRate === null ? "Not yet" : `${e.collectionRate.toFixed(1)}%`} note={e.collectionRate === null ? "Nothing has come due" : undefined} />
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-ui-muted">
            You were paid in full when each plan opened. What buyers still owe is collected by Polaris, and the risk is ours.
          </p>
          <div className="mt-4 border-t border-ui-hairline pt-4">
            <p className="flex items-center gap-2 text-[14px] font-medium">
              <ShieldCheck aria-hidden size={16} strokeWidth={1.75} className="text-ui-lime" />
              Why your buyers got credit
            </p>
            {reasons.source === "not_connected" ? (
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">{reasons.reason}</p>
            ) : (
              <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
                {reasons.data.reasons.slice(0, 4).map((r) => (
                  <li key={r.text} className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="min-w-0 truncate">{r.text}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[12px] text-ui-muted">{r.source}</span>
                      <span className="ui-figure font-medium text-ui-up">+{r.points}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" }) {
  return (
    <div className="rounded-ui-tile bg-ui-surface-2 px-4 py-3">
      <p className="text-[13px] text-ui-muted">{label}</p>
      <p className={cn("ui-figure mt-1 text-[19px] leading-tight font-medium", tone === "warn" && "text-ui-warn")}>{value}</p>
      {note ? <p className="mt-0.5 text-[12px] text-ui-muted">{note}</p> : null}
    </div>
  );
}

/* ── Collections: the Chainlink CRE workflow's last and next run ────────── */

function CollectionsPanel({ plans, sample }: { plans?: Plan[]; sample: boolean }) {
  const now = useNow(1000);
  const run = useMemo(() => (plans ? getCollectionsRun({ sample, plans }) : null), [plans, sample]);
  // Keep the placeholder's clock moving: the next run is always the next minute.
  const nextAt = run && run.source !== "not_connected" ? Math.ceil((now - 4000) / 60_000) * 60_000 + 4000 : null;
  const lastAt = nextAt ? nextAt - 60_000 : null;
  return (
    <Panel title="Collections" subtitle="Chainlink CRE workflow" sample={sample}>
      {!run ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : run.source === "not_connected" ? (
        <PanelEmpty icon={<Workflow />} title="Not reporting yet" description={run.reason} />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <div className="rounded-ui-tile bg-ui-surface-2 px-4 py-3">
              <p className="text-[13px] text-ui-muted">Last run</p>
              <p className="ui-figure mt-1 text-[19px] leading-tight font-medium">{lastAt ? `${Math.max(0, Math.round((now - lastAt) / 1000))} s ago` : "—"}</p>
            </div>
            <div className="rounded-ui-tile bg-ui-surface-2 px-4 py-3">
              <p className="text-[13px] text-ui-muted">Next run</p>
              <p className="ui-figure mt-1 text-[19px] leading-tight font-medium">{nextAt ? `in ${Math.max(0, Math.round((nextAt - now) / 1000))} s` : "—"}</p>
            </div>
          </div>
          <dl className="mt-4 grid gap-2 text-[14px]">
            <Line label="Schedule" value={`${run.data.schedule} · ${run.data.workflow}`} />
            <Line label="Plans checked" value={String(run.data.lastRun.checked)} />
            <Line label="Collected last run" value={`${run.data.lastRun.collected} · ${money(run.data.lastRun.collectedCents)}`} />
            <Line label="Retrying" value={String(run.data.lastRun.retrying)} />
          </dl>
          {run.data.lastRun.skipped.length ? (
            <p className="mt-3 text-[13px] leading-snug text-ui-muted">{run.data.lastRun.skipped[0]!.reason}.</p>
          ) : null}
          <p className="mt-4 text-[12px] text-ui-muted">Instalments collected, last 12 runs</p>
          <div className="mt-2 flex h-10 items-end gap-1" aria-hidden>
            {run.data.history.map((n, i) => (
              <span key={i} className={cn("flex-1 rounded-full", n ? "bg-ui-lime" : "bg-ui-surface-3")} style={{ height: `${n ? 30 + n * 30 : 18}%` }} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ui-hairline pb-2 last:border-0 last:pb-0">
      <dt className="text-ui-muted">{label}</dt>
      <dd className="ui-figure truncate text-right">{value}</dd>
    </div>
  );
}

/* ── Indexed by Envio: the live event feed ──────────────────────────────── */

const EVENT_LABEL: Record<string, string> = {
  "payment.succeeded": "Payment",
  "plan.opened": "Plan opened",
  "installment.collected": "Instalment collected",
  "installment.failed": "Instalment failed",
  "plan.completed": "Plan completed",
  "plan.liquidated": "Plan closed",
  "subscription.charged": "Subscription",
  "subscription.canceled": "Subscription canceled",
  "payout.paid": "Payout",
};

function EnvioFeed({ payments, plans, sample, className }: { payments?: Payment[]; plans?: Plan[]; sample: boolean; className?: string }) {
  const now = useNow(10_000);
  const feed = useMemo(() => (payments && plans ? getIndexedEvents({ sample, payments, plans }) : null), [payments, plans, sample]);
  const [live, setLive] = useState<IndexedEvent[]>([]);

  // Sample mode: a new sample event every few seconds, so the feed moves as it will live.
  useEffect(() => {
    if (!feed || feed.source !== "placeholder") return;
    let seq = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setLive((l) => [placeholderNextEvent(seq++), ...l].slice(0, 3));
    }, 9000);
    return () => clearInterval(id);
  }, [feed]);

  const events = feed && feed.source !== "not_connected" ? [...live, ...feed.data].slice(0, 6) : [];
  return (
    <Panel
      title="Indexed by Envio"
      subtitle="Chain events as they settle"
      sample={sample}
      className={className}
      action={
        // "Streaming" only when it is: sample events carry the Sample chip instead.
        feed?.source === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ui-surface-2 px-2.5 py-1 text-[12px] font-medium text-ui-muted">
            <Radio aria-hidden size={13} strokeWidth={1.75} className="text-ui-lime" />
            Streaming
          </span>
        ) : null
      }
    >
      {!feed ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : feed.source === "not_connected" ? (
        <PanelEmpty icon={<BadgeCheck />} title="The indexer isn't connected yet" description={feed.reason} />
      ) : (
        <ul className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
          <AnimatePresence initial={false}>
            {events.map((ev) => (
              <motion.li
                key={ev.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex min-w-0 items-center gap-3 rounded-ui-row bg-ui-surface-2 px-3.5 py-2.5"
              >
                <span className={cn("size-2 shrink-0 rounded-full", ev.type.startsWith("plan") || ev.type.startsWith("installment") ? "bg-ui-pink" : ev.type.startsWith("subscription") ? "bg-ui-honey" : "bg-ui-teal")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {EVENT_LABEL[ev.type] ?? ev.type} · {ev.title}
                  </span>
                  <span className="ui-figure block truncate text-[12px] text-ui-muted">
                    Block {ev.block.toLocaleString("en-US")} · {shortAddress(ev.txHash, 6, 4)} · {formatAgo(ev.at, now)}
                  </span>
                </span>
                <span className="ui-figure shrink-0 text-[14px] font-medium">{money(ev.amountCents)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
