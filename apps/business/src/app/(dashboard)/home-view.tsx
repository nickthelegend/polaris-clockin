"use client";

import Link from "next/link";
import { ArrowDownToLine, ChevronRight, Plus } from "lucide-react";

import { CollectorStrip } from "@/components/collector";
import { SampleDataNote } from "@/components/shell";
import { ButtonLink, DisplayMoney, ErrorState, Pill, Skeleton, Status, cx } from "@/components/ui";
import type { Overview } from "@/lib/data/types";
import { formatTime, MODE_LABEL, money, shortAddress } from "@/lib/data/format";
import { useMerchant } from "@/lib/merchant-context";
import { useQuery } from "@/lib/session";

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomeView() {
  const { merchant } = useMerchant();
  const { data, error, loading, reload } = useQuery((d) => d.getOverview(), { refreshMs: 30_000 });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <h1 className="page-title">
          {greeting()}, {merchant.businessName}
        </h1>
      </header>
      <SampleDataNote />

      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <BalancePanel data={data} loading={loading} />
          <TodayPanel data={data} loading={loading} />
          <PayInFourPanel data={data} loading={loading} />
          <AutoPayoutsPanel data={data} loading={loading} />
        </div>
      )}
    </>
  );
}

type PanelProps = { data: Overview | undefined; loading: boolean };

function BalancePanel({ data, loading }: PanelProps) {
  return (
    <section aria-labelledby="balance-title" className="panel relative isolate flex flex-col overflow-hidden p-6 sm:p-7">
      <div aria-hidden className="grid-ground absolute inset-0 -z-10" />
      <h2 id="balance-title" className="flex items-center gap-2 text-[14px] text-muted">
        <span aria-hidden className="inline-block h-[11px] w-[15px] rounded-[3px] bg-lime" />
        Balance
      </h2>

      <p className="mt-4 text-[52px] sm:text-[60px]">
        {loading || !data ? <Skeleton width="5.5ch" height="0.9em" /> : <DisplayMoney cents={data.balanceCents} />}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill>Settled in dollars on Monad</Pill>
        {data && data.today.grossCents > 0 ? <Pill className="figure">+{money(data.today.grossCents)} today</Pill> : null}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-8">
        <ButtonLink href="/payouts" icon={<ArrowDownToLine className="size-4" aria-hidden />}>
          Withdraw
        </ButtonLink>
        <ButtonLink href="/links" variant="secondary" icon={<Plus className="size-4" aria-hidden />}>
          New payment link
        </ButtonLink>
      </div>
    </section>
  );
}

function TodayPanel({ data, loading }: PanelProps) {
  const payments = data?.today.payments ?? [];
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="today-title" className="section-title">
          Today
        </h2>
        <p className="figure text-[14px] text-muted">
          {loading || !data ? (
            <Skeleton width="10ch" />
          ) : (
            <>
              {data.today.count} {data.today.count === 1 ? "payment" : "payments"} ·{" "}
              <span className="font-medium text-text">{money(data.today.grossCents)}</span>
            </>
          )}
        </p>
      </div>

      <ul className="mt-4 grid flex-1 content-start">
        {loading || !data ? (
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center justify-between border-b border-line py-3 last:border-0">
              <Skeleton width="45%" />
              <Skeleton width="16%" />
            </li>
          ))
        ) : payments.length === 0 ? (
          <li className="py-8 text-center text-[13.5px] text-muted">
            No payments yet today. Share a link and they appear here the moment they settle.
          </li>
        ) : (
          payments.map((p) => (
            <li key={p.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3 last:border-0">
              <span className="figure text-[13px] whitespace-nowrap text-muted">{formatTime(p.createdAt)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{p.description}</span>
                <span className="block text-[12px] text-muted">
                  {MODE_LABEL[p.mode]}
                  {p.status === "failed" ? " · failed" : ""}
                </span>
              </span>
              <span
                className={cx(
                  "figure text-right text-[14px] font-medium",
                  p.status === "failed" && "text-muted line-through decoration-1",
                )}
              >
                {money(p.amountCents)}
              </span>
            </li>
          ))
        )}
      </ul>

      <Link href="/payments" className="mt-3 inline-flex items-center gap-1 self-start text-[13px] font-medium text-text no-underline hover:underline">
        All payments <ChevronRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}

function PayInFourPanel({ data, loading }: PanelProps) {
  const e = data?.exposure;
  const atRisk = (e?.atRiskCents ?? 0) > 0;
  return (
    <section aria-labelledby="p4-title" className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="p4-title" className="section-title">
          Pay in 4
        </h2>
        <Link href="/plans" className="inline-flex items-center gap-1 text-[13px] font-medium text-text no-underline hover:underline">
          Open the ledger <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mt-1.5 max-w-[54ch] text-[13px] leading-relaxed text-muted">
        You were paid in full when each plan opened. What buyers still owe is collected by Polaris, and the risk is ours.
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
        <Figure
          label="Collecting"
          value={e ? money(e.collectingCents) : undefined}
          note={e ? `${e.collectingPlans} ${e.collectingPlans === 1 ? "plan" : "plans"} on schedule` : undefined}
          loading={loading}
          first
        />
        <Figure
          label="At risk"
          value={e ? money(e.atRiskCents) : undefined}
          note={e ? (atRisk ? `${e.atRiskPlans} retrying` : "Nothing retrying") : undefined}
          tone={atRisk ? "warn" : undefined}
          loading={loading}
        />
        <Figure
          label="Collected this week"
          value={e ? money(e.collectedThisWeekCents) : undefined}
          loading={loading}
        />
      </dl>

      <div className="mt-6 border-t border-line pt-4">
        {data ? <CollectorStrip collector={data.collector} /> : <Skeleton width="40%" />}
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
  loading,
  first,
}: {
  label: string;
  value?: string;
  note?: string;
  tone?: "warn";
  loading: boolean;
  first?: boolean;
}) {
  return (
    <div className={cx("grid content-start gap-1", !first && "sm:pl-5")}>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={cx("figure text-[22px] font-semibold tracking-[-0.02em]", tone === "warn" && "text-warn-text")}>
        {loading || !value ? <Skeleton width="6ch" /> : value}
      </dd>
      {note ? <dd className="text-[12.5px] text-muted">{note}</dd> : null}
    </div>
  );
}

function AutoPayoutsPanel({ data, loading }: PanelProps) {
  const auto = data?.autoPayouts;
  return (
    <section aria-labelledby="auto-title" className="panel flex flex-col p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="auto-title" className="section-title">
          Automatic payouts
        </h2>
        {loading || !auto ? (
          <Skeleton width="3ch" />
        ) : auto.enabled ? (
          <Status tone="neutral">On</Status>
        ) : (
          <Status tone="muted">Off</Status>
        )}
      </div>

      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        {loading || !auto ? (
          <Skeleton width="80%" />
        ) : auto.enabled && auto.payoutAddress ? (
          <>
            Every day at <span className="figure text-text">{String(auto.hourUtc).padStart(2, "0")}:00 UTC</span>, your
            whole balance goes to <span className="machine text-text">{shortAddress(auto.payoutAddress)}</span>. Nothing
            else can be sent.
          </>
        ) : (
          <>Sweep your balance to one address every day, without signing each time. Only that address can receive it.</>
        )}
      </p>

      <div className="mt-auto pt-6">
        <ButtonLink href="/payouts" variant="secondary" size="sm">
          {auto?.enabled ? "Manage payouts" : "Set up automatic payouts"}
        </ButtonLink>
      </div>
    </section>
  );
}
