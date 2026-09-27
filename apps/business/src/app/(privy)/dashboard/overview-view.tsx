"use client";

import {
  BarChart,
  CandlestickChart,
  ChartTypeToggle,
  Coin,
  DataTable,
  DeltaChip,
  DollarCoin,
  DonutChart,
  GradientLineChart,
  PairHeader,
  PolarisCoin,
  ProgressLegend,
  Skeleton,
  StatusPill,
  TableName,
  TimeframeChips,
  cn,
  type ChartType,
  type CoinTone,
  type StatusPillTone,
} from "@polaris/ui";
import { ArrowRight, BadgeCheck, Layers, ShieldCheck, Users, Workflow } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MoneyWidget } from "@/components/dashboard/money-widget";
import { DataModeNotice, LoadError, Panel, PanelEmpty, SampleBadge, SeeAll, StaleNotice, useNow } from "@/components/dashboard/common";
import { RegistrationNotice } from "@/components/dashboard/registration";
import { customersThisWeek, salesByMode, salesSeries, SERIES_FRAMES, type SeriesFrame } from "@/lib/data/analytics";
import { formatAgo, MODE_LABEL, money, shortAddress } from "@/lib/data/format";
import { getCollectionsRun, getIndexedEvents, getUnderwritingReasons, placeholderNextEvent, type IndexedEvent } from "@/lib/data/insights";
import type { Overview, PayMode, Payment, Plan } from "@/lib/data/types";
import { useMerchant } from "@/lib/merchant-context";
import { useQuery, useSample, type QueryState } from "@/lib/session";

/** Each mode in ref E's pill colours: lime, purple, teal. */
export const MODE_COLOR: Record<PayMode, string> = {
  now: "var(--ui-lime-button)",
  later: "var(--ui-pill-purple-text)",
  subscribe: "var(--ui-pill-teal-text)",
};
const MODE_COIN: Record<PayMode, CoinTone> = { now: "lime", later: "purple", subscribe: "teal" };

/**
 * The Overview is ref E's main screen, mapped to Polaris: the sales chart
 * with the recent payments under it on the left, the money widget (withdraw,
 * request) on the right, and the rest of the business in a row of cards.
 */
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
      <h1 className="sr-only">Overview, {merchant.businessName}</h1>
      <StaleNotice queries={[overview, payments, plans] as QueryState<unknown>[]} />
      <RegistrationNotice className="mb-6" />
      <DataModeNotice empty={empty} />

      {/* Ref E: the chart and the table on the left, the widget on the right. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_356px] xl:grid-cols-[minmax(0,1fr)_404px] xl:gap-x-11">
        <SalesChart payments={payments} sample={sample.on} className="lg:col-start-1 lg:row-start-1" />
        <MoneyWidget payments={list} className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />
        <RecentPayments payments={payments} sample={sample.on} className="lg:col-start-1 lg:row-start-2" />
      </div>

      <h2 className="mt-14 text-[22px] leading-tight font-medium tracking-[-0.02em] sm:mt-16">Your business this month</h2>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CustomersPanel payments={list} error={payments.error && !list ? payments : null} sample={sample.on} />
        <ModesPanel payments={list} sample={sample.on} />
        <ExposurePanel overview={overview.data} plans={plans.data} sample={sample.on} className="md:col-span-2 xl:col-span-1" />
        <CollectionsPanel plans={plans.data} collector={overview.data?.collector} sample={sample.on} />
        <EnvioFeed payments={list} plans={plans.data} sample={sample.on} className="xl:col-span-2" />
      </div>
    </>
  );
}

/* ── The big chart: ref E's pair header, figure, timeframes and line ────── */

type Metric = "sales" | "later" | "subscribe";

const METRICS: { value: Metric; label: string; description: string; mode?: PayMode }[] = [
  { value: "sales", label: "Sales / USD", description: "Every paid payment" },
  { value: "later", label: "Pay in 4 / USD", description: "Paid to you in full at checkout", mode: "later" },
  { value: "subscribe", label: "Subscriptions / USD", description: "Every subscription charge", mode: "subscribe" },
];

const FRAME_SUFFIX: Record<SeriesFrame, string> = { "1h": "this hour", "24h": "today", "1w": "this week", "1m": "this month" };
const FRAME_TITLE: Record<SeriesFrame, string> = { "1h": "the last hour", "24h": "the last 24 hours", "1w": "the last 7 days", "1m": "the last 30 days" };

const axis = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (v: number) => `$${axis(v)}`;

function timeLabel(frame: SeriesFrame) {
  return (t: string | number) => {
    const d = new Date(t);
    if (frame === "1h" || frame === "24h") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (frame === "1w") return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
}

function SalesChart({ payments, sample, className }: { payments: QueryState<Payment[]>; sample: boolean; className?: string }) {
  const [metric, setMetric] = useState<Metric>("sales");
  const [frame, setFrame] = useState<SeriesFrame>("24h");
  const [type, setType] = useState<ChartType>("line");
  const now = useNow(60_000);
  const m = METRICS.find((x) => x.value === metric)!;
  const list = payments.data;
  const series = useMemo(() => (list ? salesSeries(list, frame, { mode: m.mode, now }) : null), [list, frame, m.mode, now]);
  const time = timeLabel(frame);
  const window = SERIES_FRAMES[frame].windowLabel;
  const described = `${m.label.replace(" / USD", "")} in dollars over ${FRAME_TITLE[frame]}, each point the rolling ${window} total`;

  return (
    <section aria-label={`${m.label.replace(" / USD", "")} chart`} className={cn("min-w-0", className)}>
      <PairHeader
        coins={[<PolarisCoin key="p" size={50} />, <DollarCoin key="d" size={50} />]}
        title={m.label}
        options={METRICS.map(({ value, label, description }) => ({ value, label, description }))}
        value={metric}
        onValueChange={setMetric}
        menuLabel="Choose what to chart"
        trailing={<ChartTypeToggle value={type} onValueChange={setType} />}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {series ? (
            <>
              <span className="ui-figure text-[36px] leading-none font-medium tracking-[-0.035em] sm:text-[44px]" title={`Paid over ${FRAME_TITLE[frame]}`}>
                {money(series.grossCents)}
              </span>
              <DeltaChip
                value={series.deltaPct}
                suffix={series.deltaPct === null ? undefined : FRAME_SUFFIX[frame]}
                label={series.deltaPct === null ? (series.count ? "New" : "No sales yet") : undefined}
                title={series.deltaPct === null ? "Nothing to compare with yet" : SERIES_FRAMES[frame].versus}
              />
              {sample ? <SampleBadge /> : null}
            </>
          ) : (
            <Skeleton width={260} height={44} />
          )}
        </div>
        <TimeframeChips options={["1h", "24h", "1w", "1m"] as const} value={frame} onValueChange={setFrame} aria-label="Timeframe" />
      </div>

      <div className="mt-6">
        {payments.error && !list ? (
          <div className="grid h-[380px] place-items-center">
            <LoadError query={payments as QueryState<unknown>} title="We couldn't load your sales" />
          </div>
        ) : !series ? (
          <Skeleton shape="card" height={380} />
        ) : type === "line" ? (
          <GradientLineChart
            key={`${metric}-${frame}`}
            label={described}
            data={series.points}
            height={380}
            formatValue={dollars}
            formatAxis={axis}
            formatTime={time}
            formatBubbleNote={null}
            empty={`No ${metric === "sales" ? "sales" : m.label.replace(" / USD", "")} in ${FRAME_TITLE[frame]}`}
          />
        ) : (
          <CandlestickChart
            key={`${metric}-${frame}-c`}
            label={`${described}, as candles`}
            data={series.candles}
            height={380}
            formatPrice={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`)}
            formatTime={time}
            className="rounded-[20px]"
          />
        )}
      </div>
    </section>
  );
}

/* ── Recent payments: ref E's borderless table with status pills ────────── */

/** A payment's pill, in ref E's colours: how it was paid, or that it failed. */
export function paymentPill(p: Payment): { tone: StatusPillTone; text: string } {
  if (p.status === "failed") return { tone: "red", text: "Failed" };
  if (p.mode === "later") return { tone: "purple", text: "Pay in 4" };
  if (p.mode === "subscribe") return { tone: "teal", text: "Subscription" };
  return { tone: "lime", text: "Paid" };
}

/** The first column: a small coin in the mode's colour and the buyer, like the reference's exchange column. */
export function PaymentName({ p, sub }: { p: Payment; sub?: boolean }) {
  return (
    <TableName
      icon={
        <Coin tone={MODE_COIN[p.mode]} size={28}>
          <span className="text-[13px]">{p.description.trim()[0]?.toUpperCase() ?? "·"}</span>
        </Coin>
      }
      title={<span className="ui-figure">{shortAddress(p.buyer, 6, 4)}</span>}
      sub={sub ? p.description : undefined}
    />
  );
}

function RecentPayments({ payments, sample, className }: { payments: QueryState<Payment[]>; sample: boolean; className?: string }) {
  const router = useRouter();
  const now = useNow(30_000);
  const rows = payments.data?.slice(0, 5) ?? [];
  return (
    <section aria-label="Recent payments" className={cn("min-w-0", className)}>
      <DataTable
        caption="Recent payments"
        loading={!payments.data && !payments.error}
        loadingRows={4}
        rows={rows}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/dashboard/payments?open=${encodeURIComponent(p.id)}`)}
        empty={<PanelEmpty icon={<Layers />} title="No payments yet" description="Your latest payments land here the second they settle." />}
        columns={[
          { key: "customer", header: "Customer", render: (p) => <PaymentName p={p} /> },
          { key: "item", header: "Item", hideBelow: "md", render: (p) => <span className="block max-w-[220px] truncate" title={p.description}>{p.description}</span> },
          {
            key: "amount",
            header: "Amount",
            render: (p) => <span className={cn("ui-figure", p.status === "failed" && "text-ui-muted line-through")}>{money(p.amountCents)}</span>,
          },
          {
            key: "status",
            header: "Status",
            hideBelow: "sm",
            render: (p) => {
              const pill = paymentPill(p);
              return <StatusPill tone={pill.tone}>{pill.text}</StatusPill>;
            },
          },
          {
            key: "net",
            header: "Net",
            render: (p) => (
              <span className="ui-figure" title={formatAgo(p.createdAt, now)}>
                {p.status === "failed" ? "$0.00" : money(p.netCents)}
              </span>
            ),
          },
        ]}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        {sample ? <SampleBadge /> : <span />}
        <Link
          href="/dashboard/payments"
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-1 text-[15px] text-ui-muted transition-colors hover:text-ui-lime-active"
        >
          All payments
          <ArrowRight aria-hidden size={16} strokeWidth={1.75} />
        </Link>
      </div>
    </section>
  );
}

/* ── Customers this week (bars) ─────────────────────────────────────────── */

function CustomersPanel({ payments, error, sample }: { payments?: Payment[]; error: QueryState<Payment[]> | null; sample: boolean }) {
  const week = useMemo(() => (payments ? customersThisWeek(payments) : null), [payments]);
  return (
    <Panel title="Customers this week" sample={sample} action={<SeeAll href="/dashboard/payments" />}>
      {error ? (
        <LoadError query={error as QueryState<unknown>} />
      ) : !week ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : week.total === 0 ? (
        <PanelEmpty icon={<Users />} title="No buyers yet this week" description="Each bar is the people who paid you that day." />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="ui-figure text-[34px] leading-none font-medium tracking-[-0.03em]">{week.total}</span>
            {week.deltaPct === null ? (
              <DeltaChip value={null} label="New this week" size="sm" />
            ) : (
              <DeltaChip value={week.deltaPct} suffix="vs last week" size="sm" decimals={1} />
            )}
          </div>
          <BarChart
            className="mt-6"
            label="Buyers per day this week"
            data={week.days.map((d) => ({ label: d.label, value: d.value }))}
            defaultSelected={week.days.findIndex((d) => d.today)}
            height={236}
            formatValue={(v) => `${v} ${v === 1 ? "buyer" : "buyers"}`}
            formatTick={(v) => String(Math.round(v))}
          />
        </>
      )}
    </Panel>
  );
}

/* ── Sales by mode (donut) ──────────────────────────────────────────────── */

function ModesPanel({ payments, sample }: { payments?: Payment[]; sample: boolean }) {
  const split = useMemo(() => (payments ? salesByMode(payments, { days: 30 }) : null), [payments]);
  const total = split?.reduce((s, m) => s + m.cents, 0) ?? 0;
  return (
    <Panel title="Sales by mode" subtitle={split ? `Last 30 days · ${money(total)}` : "Last 30 days"} sample={sample}>
      {!split ? (
        <Skeleton shape="tile" height={280} className="mt-5" />
      ) : total === 0 ? (
        <PanelEmpty icon={<Layers />} title="No sales in the last 30 days" description="Pay now, Pay in 4 and subscriptions split here once buyers pay." />
      ) : (
        <div className="mt-5 flex flex-col items-center gap-6">
          <DonutChart
            label="Sales by payment mode, last 30 days"
            size={212}
            gap={4}
            data={split.map((m) => ({ label: MODE_LABEL[m.mode], value: m.cents / 100, color: MODE_COLOR[m.mode] }))}
            formatValue={(v) => `$${Math.round(v).toLocaleString("en-US")}`}
            showTags={false}
            centerLabel="Total"
            centerValue={`$${Math.round(total / 100).toLocaleString("en-US")}`}
            className="shrink-0"
          />
          <ProgressLegend className="w-full min-w-0" items={split.map((m) => ({ label: MODE_LABEL[m.mode], value: m.share, color: MODE_COLOR[m.mode] }))} />
        </div>
      )}
    </Panel>
  );
}

/* ── Credit exposure, with the reasons behind the lines (Nansen) ────────── */

function ExposurePanel({ overview, plans, sample, className }: { overview?: Overview; plans?: Plan[]; sample: boolean; className?: string }) {
  const e = overview?.exposure;
  const reasons = useMemo(() => (plans ? getUnderwritingReasons({ sample, plans }) : null), [plans, sample]);
  return (
    <Panel title="Credit exposure" subtitle="Pay in 4 plans still collecting" sample={sample} action={<SeeAll href="/dashboard/plans">Ledger</SeeAll>} className={className}>
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
          <div className="mt-4 border-t border-ui-hairline-strong pt-4">
            <p className="flex items-center gap-2 text-[14px] font-medium">
              <ShieldCheck aria-hidden size={16} strokeWidth={1.75} className="text-ui-lime-text" />
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
                      <StatusPill tone="lime" size="sm" className="ui-figure h-6 px-2 text-[12px]">
                        +{r.points}
                      </StatusPill>
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
    <div className="rounded-[18px] bg-ui-surface-1 px-4 py-3">
      <p className="text-[13px] text-ui-muted">{label}</p>
      <p className={cn("ui-figure mt-1 text-[19px] leading-tight font-medium tracking-[-0.01em]", tone === "warn" && "text-ui-pill-amber-text")}>{value}</p>
      {note ? <p className="mt-0.5 text-[12px] text-ui-muted">{note}</p> : null}
    </div>
  );
}

/* ── Collections: the Chainlink CRE workflow's last and next run ────────── */

function CollectionsPanel({ plans, collector, sample }: { plans?: Plan[]; collector?: Overview["collector"]; sample: boolean }) {
  const now = useNow(1000);
  const run = useMemo(() => (plans ? getCollectionsRun({ sample, plans, collector }) : null), [plans, sample, collector]);
  // The placeholder's clock keeps moving (the next run is always the next
  // minute); a live run shows its real report time.
  const nextAt =
    run?.source === "placeholder"
      ? Math.ceil((now - 4000) / 60_000) * 60_000 + 4000
      : run?.source === "live"
        ? Date.parse(run.data.nextRunAt)
        : null;
  const lastAt = run?.source === "live" ? Date.parse(run.data.lastRun.at) : nextAt ? nextAt - 60_000 : null;
  const ago = (ms: number) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : formatAgo(new Date(now - ms).toISOString(), now));
  return (
    <Panel title="Collections" subtitle="Chainlink CRE workflow" sample={sample}>
      {!run ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : run.source === "not_connected" ? (
        <PanelEmpty icon={<Workflow />} title="Not reporting yet" description={run.reason} />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Figure label="Last run" value={lastAt ? ago(now - lastAt) : "—"} />
            <Figure
              label="Next run"
              value={nextAt ? (nextAt > now ? `in ${Math.round((nextAt - now) / 1000)} s` : run.data.state === "running" ? "due now" : "overdue") : "—"}
            />
          </div>
          <dl className="mt-4 grid gap-2.5 text-[14px]">
            <Line label="Schedule" value={`${run.data.schedule} · ${run.data.workflow}`} />
            <Line label="Plans checked" value={String(run.data.lastRun.checked)} />
            {run.data.lastRun.collected !== null ? (
              <Line label="Collected last run" value={`${run.data.lastRun.collected} · ${money(run.data.lastRun.collectedCents ?? 0)}`} />
            ) : (
              <Line label="Workflow" value={run.data.state === "running" ? "Reporting" : run.data.state === "degraded" ? "Late" : "Stopped"} />
            )}
            <Line label="Retrying" value={String(run.data.lastRun.retrying)} />
          </dl>
          {run.data.lastRun.skipped.length ? <p className="mt-3 text-[13px] leading-snug text-ui-muted">{run.data.lastRun.skipped[0]!.reason}.</p> : null}
          {run.data.history.length ? (
            <>
              <p className="mt-4 text-[12px] text-ui-muted">Instalments collected, last 12 runs</p>
              <div className="mt-2 flex h-10 items-end justify-between" aria-hidden>
                {run.data.history.map((n, i) => (
                  <span key={i} className={cn("w-2 flex-none rounded-full", n ? "bg-ui-lime-button" : "bg-ui-surface-2")} style={{ height: `${n ? 40 + n * 30 : 20}%` }} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ui-hairline pb-2.5 last:border-0 last:pb-0">
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

function eventTone(type: string): StatusPillTone {
  if (type.endsWith("failed") || type.endsWith("liquidated")) return "amber";
  if (type.startsWith("plan") || type.startsWith("installment")) return "purple";
  if (type.startsWith("subscription")) return "teal";
  return "lime";
}

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
          <StatusPill tone="lime" size="sm" icon={<span className="block size-2 rounded-full bg-current" />}>
            Streaming
          </StatusPill>
        ) : null
      }
    >
      {!feed ? (
        <Skeleton shape="tile" height={260} className="mt-5" />
      ) : feed.source === "not_connected" ? (
        <PanelEmpty icon={<BadgeCheck />} title="The indexer isn't connected yet" description={feed.reason} />
      ) : (
        <ul className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)]">
          <AnimatePresence initial={false}>
            {events.map((ev) => (
              <motion.li
                key={ev.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-ui-hairline py-3 last:border-0 sm:grid-cols-[150px_minmax(0,1fr)_auto]"
              >
                <span className="hidden sm:block">
                  <StatusPill tone={eventTone(ev.type)} size="sm">
                    {EVENT_LABEL[ev.type] ?? ev.type}
                  </StatusPill>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">
                    <span className="sm:hidden">{EVENT_LABEL[ev.type] ?? ev.type} · </span>
                    {ev.title}
                  </span>
                  <span className="ui-figure block truncate text-[12.5px] text-ui-muted">
                    Block {ev.block.toLocaleString("en-US")} · {shortAddress(ev.txHash, 6, 4)} · {formatAgo(ev.at, now)}
                  </span>
                </span>
                <span className="ui-figure shrink-0 text-[15px] font-medium">{money(ev.amountCents)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
