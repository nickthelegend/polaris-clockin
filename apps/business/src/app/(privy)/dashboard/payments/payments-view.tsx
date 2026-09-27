"use client";

import {
  Avatar,
  Button,
  Card,
  CellStack,
  DetailsList,
  Drawer,
  EmptyState,
  Input,
  KeyValueGrid,
  Money,
  Select,
  Skeleton,
  Tab,
  TabList,
  Table,
  Tabs,
  TxRow,
  type TableColumn,
} from "@polaris/ui";
import { ArrowLeftRight, CalendarClock, Download, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Address, ModeBadge, PaymentStatusBadge, TxLink, downloadCsv } from "@/components/dashboard/bits";
import { DataModeNotice, LoadError, SampleBadge, StaleNotice } from "@/components/dashboard/common";
import { DashboardHeader } from "@/components/shell/dashboard-shell";
import { formatDateTime, MODE_LABEL, money } from "@/lib/data/format";
import type { PayMode, Payment } from "@/lib/data/types";
import { useQuery, useSample, type QueryState } from "@/lib/session";

type StatusFilter = "all" | "succeeded" | "failed";
type ModeFilter = "all" | PayMode;

const PAGE = 40;

export function PaymentsView() {
  const payments = useQuery((d) => d.listPayments(), { refreshMs: 30_000 });
  const sample = useSample();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("open");

  const [status, setStatus] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const list = payments.data;
  const filtered = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    return list.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (mode === "all" || p.mode === mode) &&
        (!q || `${p.description} ${p.orderId} ${p.id} ${p.buyer}`.toLowerCase().includes(q)),
    );
  }, [list, status, mode, query]);

  const counts = useMemo(
    () => ({
      all: list?.length ?? 0,
      succeeded: list?.filter((p) => p.status === "succeeded").length ?? 0,
      failed: list?.filter((p) => p.status === "failed").length ?? 0,
    }),
    [list],
  );

  const open = openId ? (list?.find((p) => p.id === openId) ?? null) : null;
  const setOpen = (p: Payment | null) => {
    const next = new URLSearchParams(params.toString());
    if (p) next.set("open", p.id);
    else next.delete("open");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const exportCsv = () =>
    downloadCsv(
      `polaris-payments-${new Date().toISOString().slice(0, 10)}.csv`,
      ["id", "order", "created_at", "description", "mode", "status", "amount_usd", "fee_usd", "net_usd", "buyer", "tx_hash"],
      filtered.map((p) => [
        p.id,
        p.orderId,
        p.createdAt,
        p.description,
        MODE_LABEL[p.mode],
        p.status === "succeeded" ? "paid" : "failed",
        (p.amountCents / 100).toFixed(2),
        (p.feeCents / 100).toFixed(2),
        (p.netCents / 100).toFixed(2),
        p.buyer,
        p.txHash,
      ]),
    );

  const shown = filtered.slice(0, limit);

  return (
    <>
      <DashboardHeader
        title="Payments"
        description="Every payment to your links and checkouts, newest first. Rows open the full record."
        actions={
          <Button variant="outline" size="md" icon={<Download />} onClick={exportCsv} disabled={!filtered.length}>
            Export CSV
          </Button>
        }
      />
      <StaleNotice queries={[payments as QueryState<unknown>]} />
      <DataModeNotice empty={list !== undefined && list.length === 0} />

      <Summary payments={list} sample={sample.on} />

      <Card padding="none" className="mt-4 min-w-0">
        <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5 sm:pt-5 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)} variant="pill">
            <TabList aria-label="Filter by status">
              <Tab value="all" count={counts.all}>
                All
              </Tab>
              <Tab value="succeeded" count={counts.succeeded}>
                Paid
              </Tab>
              <Tab value="failed" count={counts.failed}>
                Failed
              </Tab>
            </TabList>
          </Tabs>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              hideLabel
              label="Search payments"
              placeholder="Search description, order or buyer"
              icon={<Search />}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              wrapperClassName="w-full sm:w-[300px]"
              className="h-11"
            />
            <Select<ModeFilter>
              aria-label="Payment mode"
              variant="outline"
              value={mode}
              onValueChange={(v) => {
                setMode(v);
                setLimit(PAGE);
              }}
              options={[
                { value: "all", label: "All modes" },
                { value: "now", label: "Pay now" },
                { value: "later", label: "Pay in 4" },
                { value: "subscribe", label: "Subscribe" },
              ]}
            />
          </div>
        </div>

        {payments.error && !list ? (
          <LoadError query={payments as QueryState<unknown>} title="We couldn't load your payments" />
        ) : !list ? (
          <div className="grid gap-2 p-4 sm:p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} shape="row" height={60} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={list.length ? <Search /> : <ArrowLeftRight />}
            title={list.length ? "No payments match" : "No payments yet"}
            description={
              list.length
                ? "Try another word, or clear the filters."
                : "Share a payment link and each payment appears here the moment it settles."
            }
            action={
              list.length ? null : (
                <Button asChild variant="lime" size="sm">
                  <Link href="/dashboard/links?new=1">New payment link</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* From 1280px: the ledger. */}
            <div className="hidden xl:block">
              <Table
                className="mt-3 pb-2"
                caption="Payments"
                columns={columns(sample.on)}
                rows={shown}
                rowKey={(p) => p.id}
                onRowClick={(p) => setOpen(p)}
                selectedKey={open?.id}
              />
            </div>
            {/* Below 1280px: card rows, amounts and status always visible. */}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:p-4 xl:hidden">
              {shown.map((p) => (
                <li key={p.id}>
                  <TxRow
                    variant="card"
                    leading={<Avatar name={p.description} size="md" decorative />}
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{p.description}</span>
                        {sample.on ? <SampleBadge /> : null}
                      </span>
                    }
                    subtitle={`${MODE_LABEL[p.mode]} · ${formatDateTime(p.createdAt)}`}
                    value={
                      <span className={p.status === "failed" ? "text-ui-muted line-through" : undefined}>{money(p.amountCents)}</span>
                    }
                    subAmount={p.status === "failed" ? "Failed" : p.feeCents ? `Net ${money(p.netCents)}` : "No fee"}
                    onClick={() => setOpen(p)}
                    aria-label={`${p.description}, ${money(p.amountCents)}, ${p.status === "failed" ? "failed" : "paid"}. Open the payment.`}
                  />
                </li>
              ))}
            </ul>
            {filtered.length > shown.length ? (
              <div className="flex justify-center border-t border-ui-hairline p-4">
                <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - shown.length)} more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <PaymentDrawer payment={open} sample={sample.on} onClose={() => setOpen(null)} />
    </>
  );
}

function columns(sample: boolean): TableColumn<Payment>[] {
  return [
    {
      key: "payment",
      header: "Payment",
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
            sub={p.orderId}
          />
        </div>
      ),
    },
    { key: "mode", header: "Mode", render: (p) => <ModeBadge mode={p.mode} /> },
    { key: "status", header: "Status", render: (p) => <PaymentStatusBadge status={p.status} /> },
    { key: "date", header: "Date", render: (p) => <span className="whitespace-nowrap text-ui-muted">{formatDateTime(p.createdAt)}</span> },
    { key: "fee", header: "Fee", align: "right", render: (p) => <span className="text-ui-muted">{money(p.feeCents)}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (p) => (
        <span className={p.status === "failed" ? "text-ui-muted line-through" : "font-medium"}>{money(p.amountCents)}</span>
      ),
    },
  ];
}

function Summary({ payments, sample }: { payments?: Payment[]; sample: boolean }) {
  // "The last 30 days" from when the page opened.
  const [openedAt] = useState(() => Date.now());
  const s = useMemo(() => {
    if (!payments) return null;
    const since = openedAt - 30 * 86_400_000;
    const recent = payments.filter((p) => p.status === "succeeded" && new Date(p.createdAt).getTime() >= since);
    return {
      gross: recent.reduce((a, p) => a + p.amountCents, 0),
      fees: recent.reduce((a, p) => a + p.feeCents, 0),
      net: recent.reduce((a, p) => a + p.netCents, 0),
      count: recent.length,
    };
  }, [payments, openedAt]);
  if (!s) return <Skeleton shape="tile" height={84} />;
  return (
    <div className="relative">
      <KeyValueGrid
        columns={4}
        variant="surface"
        items={[
          { label: "Gross, 30 days", value: <Money value={s.gross / 100} /> },
          { label: "Fees", value: <Money value={s.fees / 100} /> },
          { label: "Net to you", value: <Money value={s.net / 100} /> },
          {
            label: "Paid payments",
            // One Sample chip for the whole strip, beside its shortest figure.
            value: sample ? (
              <span className="flex items-center gap-2">
                {s.count.toLocaleString("en-US")}
                <SampleBadge />
              </span>
            ) : (
              s.count.toLocaleString("en-US")
            ),
          },
        ]}
      />
    </div>
  );
}

function PaymentDrawer({ payment, sample, onClose }: { payment: Payment | null; sample: boolean; onClose: () => void }) {
  const [last, setLast] = useState<Payment | null>(payment);
  if (payment && payment !== last) setLast(payment);
  const p = payment ?? last;
  return (
    <Drawer open={payment !== null} onOpenChange={(o) => !o && onClose()} title="Payment" description={p ? `${p.orderId} · ${p.id}` : undefined}>
      {p ? (
        <Drawer.Body>
          <div className="flex items-center gap-3 pb-5">
            <Avatar name={p.description} size="lg" decorative />
            <CellStack title={p.description} sub={formatDateTime(p.createdAt)} />
            {sample ? <SampleBadge className="ml-auto" /> : null}
          </div>
          <Money value={p.amountCents / 100} className="text-[44px] leading-none font-semibold tracking-[-0.035em]" />
          <div className="mt-3 flex flex-wrap gap-2">
            <PaymentStatusBadge status={p.status} />
            <ModeBadge mode={p.mode} />
          </div>
          <KeyValueGrid
            className="mt-6"
            items={[
              { label: "Amount", value: money(p.amountCents) },
              { label: "Fee", value: p.mode === "later" ? "$0.00 (Pay in 4)" : money(p.feeCents) },
              { label: "Net to you", value: money(p.netCents) },
              { label: "Settled", value: p.status === "succeeded" ? "Under a second" : "Didn't settle" },
            ]}
          />
          <DetailsList
            className="mt-4"
            size="sm"
            items={[
              { label: "Order", value: p.orderId },
              { label: "Buyer", value: <Address value={p.buyer} label="buyer's address" explorer={!sample} /> },
              { label: "Link", value: p.linkId ?? "Checkout" },
              { label: "Transaction", value: <TxLink hash={p.txHash} sample={sample} /> },
            ]}
          />
          {p.mode === "later" && p.status === "succeeded" ? (
            <Button asChild variant="outline" size="md" icon={<CalendarClock />} className="mt-5" block>
              <Link href={`/dashboard/plans?order=${encodeURIComponent(p.orderId)}`}>Open the Pay in 4 plan</Link>
            </Button>
          ) : null}
        </Drawer.Body>
      ) : null}
    </Drawer>
  );
}
