"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { SampleDataNote } from "@/components/shell";
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, Status, TextInput, cx } from "@/components/ui";
import { explorerTx } from "@/lib/chain";
import type { PayMode, Payment } from "@/lib/data/types";
import { formatDateTime, MODE_LABEL, money, shortAddress } from "@/lib/data/format";
import { useQuery } from "@/lib/session";

type ModeFilter = "all" | PayMode;
const FILTERS: { value: ModeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "now", label: "Pay now" },
  { value: "later", label: "Pay in 4" },
  { value: "subscribe", label: "Subscriptions" },
];

const PAGE = 25;

export function PaymentsView() {
  const { data: payments, error, loading, reload } = useQuery((d) => d.listPayments(), { refreshMs: 30_000 });
  const [filter, setFilter] = useState<ModeFilter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<ModeFilter, number> = { all: 0, now: 0, later: 0, subscribe: 0 };
    for (const p of payments ?? []) {
      c.all += 1;
      c[p.mode] += 1;
    }
    return c;
  }, [payments]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payments ?? []).filter(
      (p) =>
        (filter === "all" || p.mode === filter) &&
        (!q ||
          p.description.toLowerCase().includes(q) ||
          p.orderId.toLowerCase().includes(q) ||
          p.buyer.toLowerCase().includes(q)),
    );
  }, [payments, filter, query]);

  const totals = useMemo(() => {
    let gross = 0;
    let fee = 0;
    let net = 0;
    for (const p of rows) {
      if (p.status !== "succeeded") continue;
      gross += p.amountCents;
      fee += p.feeCents;
      net += p.netCents;
    }
    return { gross, fee, net };
  }, [rows]);

  const shown = rows.slice(0, limit);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment across your links and checkout, newest first. A payment shows as succeeded only once it is final on Monad."
      />
      <SampleDataNote />

      <section aria-label="Payments" className="panel min-w-0 p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4 sm:px-3">
          <div role="group" aria-label="Filter by way of paying" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => {
                  setFilter(f.value);
                  setLimit(PAGE);
                }}
                className={cx(
                  "press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
                  filter === f.value ? "bg-ink text-on-ink" : "text-muted hover:bg-pill hover:text-text",
                )}
              >
                {f.label}
                <span className={cx("figure text-[12px]", filter === f.value ? "opacity-70" : "text-faint")}>{counts[f.value]}</span>
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-[260px]">
            <span className="sr-only">Search payments</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <TextInput
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Description, order or buyer"
              className="h-9 pl-9 text-[13px]"
            />
          </label>
        </div>

        {error && !payments ? (
          <div className="p-2">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="ledger min-w-[860px]">
                <caption className="sr-only">Payments, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Paid with</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col" className="num">
                      Fee
                    </th>
                    <th scope="col" className="num">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading || !payments ? (
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        {[14, 30, 12, 10, 10, 9, 7, 9].map((w, j) => (
                          <td key={j} className={j >= 5 ? "num" : undefined}>
                            <Skeleton width={`${w * 0.6}ch`} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : shown.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState title={query ? "No payments match" : "No payments yet"}>
                          {query
                            ? "Try part of the description, an order ID like ord_1042, or the start of a buyer's address."
                            : "Payments appear here the moment a buyer pays one of your links or a checkout session."}
                        </EmptyState>
                      </td>
                    </tr>
                  ) : (
                    shown.map((p) => <PaymentRow key={p.id} payment={p} />)
                  )}
                </tbody>
                {payments && rows.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="text-[13px] font-medium">
                        {rows.length === payments.length ? "All payments" : `${rows.length} matching`}, succeeded only
                      </td>
                      <td className="num">{money(totals.gross)}</td>
                      <td className="num text-muted">{money(totals.fee)}</td>
                      <td className="num">{money(totals.net)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {/* Phones: one entry per payment. */}
            <ul className="grid md:hidden" aria-label="Payments, newest first">
              {loading || !payments ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="grid gap-2 border-b border-line px-3 py-4 last:border-0">
                    <Skeleton width="55%" />
                    <Skeleton width="35%" />
                  </li>
                ))
              ) : shown.length === 0 ? (
                <li>
                  <EmptyState title={query ? "No payments match" : "No payments yet"}>
                    {query
                      ? "Try part of the description, an order ID like ord_1042, or the start of a buyer's address."
                      : "Payments appear here the moment a buyer pays one of your links or a checkout session."}
                  </EmptyState>
                </li>
              ) : (
                shown.map((p) => (
                  <li key={p.id} className="grid gap-1 border-b border-line px-3 py-3.5 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{p.description}</span>
                      <span
                        className={cx(
                          "figure shrink-0 font-medium",
                          p.status === "failed" && "text-muted line-through decoration-1",
                        )}
                      >
                        {money(p.amountCents)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
                      <span className="figure truncate">
                        {formatDateTime(p.createdAt)} · {MODE_LABEL[p.mode]}
                      </span>
                      {p.status === "failed" ? (
                        <Status tone="danger" className="text-[12.5px]">
                          Failed
                        </Status>
                      ) : (
                        <span className="figure shrink-0">net {money(p.netCents)}</span>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
            {payments && rows.length > 0 ? (
              <p className="figure flex justify-between border-t border-line-strong px-3 pt-3 pb-1 text-[13px] font-medium md:hidden">
                <span>Net, succeeded</span>
                <span>{money(totals.net)}</span>
              </p>
            ) : null}
          </>
        )}

        {rows.length > limit ? (
          <div className="flex justify-center p-4">
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, rows.length - limit)} more
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function PaymentRow({ payment: p }: { payment: Payment }) {
  const failed = p.status === "failed";
  return (
    <tr>
      <td className="figure whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</td>
      <td className="max-w-[16rem]">
        <span className="block truncate">{p.description}</span>
        <span className="machine block text-[12px] whitespace-nowrap text-muted">{p.orderId}</span>
      </td>
      <td>
        <span className="machine text-[12.5px] text-muted" title={p.buyer}>
          {shortAddress(p.buyer)}
        </span>
      </td>
      <td className="whitespace-nowrap">{MODE_LABEL[p.mode]}</td>
      <td>
        <span className="inline-flex items-center gap-2">
          {failed ? <Status tone="danger">Failed</Status> : <Status tone="neutral">Succeeded</Status>}
          {p.txHash ? (
            <a
              href={explorerTx(p.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View receipt for ${p.orderId} on the explorer`}
              className="text-muted hover:text-text"
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </span>
      </td>
      <td className={cx("num font-medium", failed && "text-muted line-through decoration-1")}>{money(p.amountCents)}</td>
      <td className="num text-muted">{failed ? "–" : money(p.feeCents)}</td>
      <td className="num">{failed ? "–" : money(p.netCents)}</td>
    </tr>
  );
}
