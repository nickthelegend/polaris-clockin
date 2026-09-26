"use client";

import { useMemo, useState } from "react";

import { CollectorStrip } from "@/components/collector";
import { SampleDataNote } from "@/components/shell";
import { EmptyState, ErrorState, PageHeader, Skeleton, Status, Ticks, cx } from "@/components/ui";
import type { Plan, PlanFilter } from "@/lib/data/types";
import { formatDate, formatDue, money, shortAddress } from "@/lib/data/format";
import { useQuery } from "@/lib/session";

const FILTERS: { value: PlanFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "collecting", label: "Collecting" },
  { value: "dunning", label: "Dunning" },
  { value: "closed", label: "Closed" },
];

function matches(plan: Plan, filter: PlanFilter) {
  if (filter === "collecting") return plan.state === "collecting";
  if (filter === "dunning") return plan.state === "dunning";
  if (filter === "closed") return plan.state === "repaid" || plan.state === "written_off";
  return true;
}

const EMPTY: Record<PlanFilter, { title: string; body: string }> = {
  all: {
    title: "No Pay in 4 plans yet",
    body: "A plan opens the moment a buyer splits a purchase on one of your links. You're paid in full then, and each instalment is collected automatically.",
  },
  collecting: { title: "Nothing collecting right now", body: "Every open plan is either paid up or being retried." },
  dunning: { title: "Nothing in dunning", body: "Every instalment so far collected on the first attempt." },
  closed: { title: "No closed plans", body: "Repaid and written-off plans stay here for your records." },
};

export function PlansView() {
  const { data, error, loading, reload } = useQuery(
    (d) => Promise.all([d.listPlans(), d.getOverview()]).then(([plans, overview]) => ({ plans, overview })),
    { refreshMs: 30_000 },
  );
  const [filter, setFilter] = useState<PlanFilter>("all");

  const plans = useMemo(() => data?.plans ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<PlanFilter, number> = { all: 0, collecting: 0, dunning: 0, closed: 0 };
    for (const p of plans) for (const f of FILTERS) if (matches(p, f.value)) c[f.value] += 1;
    return c;
  }, [plans]);

  const rows = plans.filter((p) => matches(p, filter));
  const exposure = data?.overview.exposure;

  return (
    <>
      <PageHeader
        title="Pay in 4"
        description="Every plan your buyers opened. You were paid in full at checkout; Polaris collects the instalments and carries the risk."
      />
      <SampleDataNote />

      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          {/* Two questions first: what is still owed, and what is at risk. */}
          <section aria-label="The book" className="panel mb-4 p-6 sm:p-7">
            <div className="grid gap-6 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:gap-10">
              <div>
                <p className="text-[13px] text-muted">Outstanding across open plans</p>
                <p className="figure-display mt-2 text-[40px] sm:text-[46px]">
                  {loading || !exposure ? <Skeleton width="6ch" /> : money(exposure.outstandingCents)}
                </p>
              </div>
              <div className="sm:border-l sm:border-line sm:pl-10">
                <p className="text-[13px] text-muted">At risk</p>
                <p
                  className={cx(
                    "figure mt-2 text-[28px] font-semibold tracking-[-0.02em]",
                    exposure && exposure.atRiskCents > 0 ? "text-warn-text" : "text-text",
                  )}
                >
                  {loading || !exposure ? <Skeleton width="5ch" /> : money(exposure.atRiskCents)}
                </p>
                <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-muted">
                  {exposure
                    ? exposure.atRiskCents > 0
                      ? `${exposure.atRiskPlans} ${exposure.atRiskPlans === 1 ? "plan is" : "plans are"} in dunning. Collection retries on a backoff.`
                      : "Nothing in dunning. Every plan is collecting on schedule."
                    : null}
                </p>
              </div>
            </div>

            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-line pt-5 text-[13.5px]">
              <div className="flex items-baseline gap-2.5">
                <dt className="text-muted">Collected this week</dt>
                <dd className="figure font-medium">{exposure ? money(exposure.collectedThisWeekCents) : "–"}</dd>
              </div>
              <div className="flex items-baseline gap-2.5">
                <dt className="text-muted">On-time collection rate</dt>
                <dd className="figure font-medium">
                  {exposure?.collectionRate == null ? "–" : `${exposure.collectionRate.toFixed(1)}%`}
                </dd>
              </div>
              <div className="flex items-baseline">{data ? <CollectorStrip collector={data.overview.collector} /> : null}</div>
            </dl>
          </section>

          <section aria-labelledby="plans-title" className="panel min-w-0 p-2 sm:p-3">
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4 sm:px-3">
              <h2 id="plans-title" className="section-title">
                Plans
              </h2>
              <div role="group" aria-label="Filter plans" className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    aria-pressed={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className={cx(
                      "press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
                      filter === f.value ? "bg-ink text-on-ink" : "text-muted hover:bg-pill hover:text-text",
                    )}
                  >
                    {f.label}
                    <span className={cx("figure text-[12px]", filter === f.value ? "opacity-70" : "text-faint")}>
                      {counts[f.value]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="ledger min-w-[880px]">
                <caption className="sr-only">Pay in 4 plans</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Instalments</th>
                    <th scope="col" className="num">
                      Principal
                    </th>
                    <th scope="col" className="num">
                      Outstanding
                    </th>
                    <th scope="col">Next collection</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {loading || !data ? (
                    Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        {[18, 12, 9, 8, 8, 10, 10].map((w, j) => (
                          <td key={j} className={j === 3 || j === 4 ? "num" : undefined}>
                            <Skeleton width={`${w * 0.6}ch`} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState title={EMPTY[filter].title}>{EMPTY[filter].body}</EmptyState>
                      </td>
                    </tr>
                  ) : (
                    rows.map((plan) => <PlanRow key={plan.id} plan={plan} />)
                  )}
                </tbody>
              </table>
            </div>

            {/* Phones: one entry per plan, the ticks kept whole. */}
            <ul className="grid md:hidden" aria-label="Pay in 4 plans">
              {loading || !data ? (
                [0, 1, 2, 3].map((i) => (
                  <li key={i} className="grid gap-3 border-b border-line px-3 py-4 last:border-0">
                    <Skeleton width="60%" />
                    <Skeleton width="35%" />
                  </li>
                ))
              ) : rows.length === 0 ? (
                <li>
                  <EmptyState title={EMPTY[filter].title}>{EMPTY[filter].body}</EmptyState>
                </li>
              ) : (
                rows.map((plan) => <PlanItem key={plan.id} plan={plan} />)
              )}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  const closed = plan.state === "repaid" || plan.state === "written_off";
  return (
    <tr>
      <td className="max-w-[16rem]">
        <span className="block truncate">{plan.description}</span>
        <span className="machine block text-[12px] whitespace-nowrap text-muted">
          {plan.orderId} · opened {formatDate(plan.openedAt)}
        </span>
      </td>
      <td>
        <span className="machine text-[12.5px] whitespace-nowrap text-muted" title={plan.buyer}>
          {shortAddress(plan.buyer)}
        </span>
      </td>
      <td>
        <Ticks paid={plan.installmentsPaid} total={plan.installmentCount} failing={plan.state === "dunning"} />
      </td>
      <td className="num">{money(plan.principalCents)}</td>
      <td className={cx("num font-medium", closed && plan.outstandingCents === 0 && "text-muted")}>
        {money(plan.outstandingCents)}
      </td>
      <td className="whitespace-nowrap">
        {plan.nextDueAt ? (
          <span className={cx("figure", plan.state === "dunning" ? "text-warn-text" : "text-text")}>{formatDue(plan.nextDueAt)}</span>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td>
        <PlanState plan={plan} />
      </td>
    </tr>
  );
}

function PlanItem({ plan }: { plan: Plan }) {
  return (
    <li className="grid gap-3 border-b border-line px-3 py-4 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate">{plan.description}</span>
          <span className="machine block truncate text-[12px] text-muted">
            {plan.orderId} · {shortAddress(plan.buyer)}
          </span>
        </span>
        <span className="figure shrink-0 text-right font-medium">
          {money(plan.outstandingCents)}
          <span className="block text-[12px] font-normal text-muted">of {money(plan.totalCents)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Ticks paid={plan.installmentsPaid} total={plan.installmentCount} failing={plan.state === "dunning"} />
        <span className="flex items-center gap-3">
          {plan.nextDueAt ? (
            <span className={cx("figure text-[13px]", plan.state === "dunning" ? "text-warn-text" : "text-muted")}>
              {formatDue(plan.nextDueAt)}
            </span>
          ) : null}
          <PlanState plan={plan} />
        </span>
      </div>
    </li>
  );
}

function PlanState({ plan }: { plan: Plan }) {
  switch (plan.state) {
    case "collecting":
      // Lime means one thing on this page: the collector is working this plan.
      return <Status tone="live">Collecting</Status>;
    case "dunning":
      return (
        <Status tone="warn">
          Retrying · {plan.attempts} {plan.attempts === 1 ? "try" : "tries"}
        </Status>
      );
    case "repaid":
      return <Status tone="muted">Repaid</Status>;
    case "written_off":
      return <Status tone="danger">Written off</Status>;
  }
}
