"use client";

import {
  BalanceSummaryCard,
  CandlestickChart,
  ChartTypeToggle,
  DataTable,
  DeltaChip,
  DollarCoin,
  GradientLineChart,
  IconSquareButton,
  PairHeader,
  PolarisCoin,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  SwapCard,
  SwapStack,
  SwapToggle,
  TextTabs,
  TimeframeChips,
  cn,
  type ChartType,
  type GradientPoint,
} from "@polaris/ui";
import { Check, RotateCcw, Store, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState } from "react";

import { ModeCoin } from "@/components/dashboard/payment-bits";
import { DEMO_SHOP_URL } from "@/lib/features";
import { money, parseAmount, payInFourQuote } from "@/lib/data/format";

/*
  The landing's and the sign-in page's product visual, built from ref E's
  components with an invented studio's numbers: the sales chart (pair
  header, figure, timeframes, the gradient line or candles, recent payments)
  beside the checkout widget (Pay now / Pay in 4, the stacked cards, the lime
  button and the summary card). Everything is deterministic (no clock, no
  random) so the server and the browser agree, and nothing leaves the page.
*/

type Frame = "1h" | "24h" | "1w" | "1m";

const FRAMES: Record<Frame, { n: number; stepMin: number; scale: number; seed: number; total: number; delta: number }> = {
  "1h": { n: 61, stepMin: 1, scale: 0.06, seed: 3.1, total: 1_482_00, delta: 4.12 },
  "24h": { n: 73, stepMin: 20, scale: 1, seed: 0.6, total: 24_575_00, delta: 3.27 },
  "1w": { n: 85, stepMin: 120, scale: 5.2, seed: 1.7, total: 139_240_00, delta: 8.4 },
  "1m": { n: 91, stepMin: 480, scale: 19, seed: 2.4, total: 562_910_00, delta: 12.6 },
};

/** A sales line with a price chart's texture: a slow swell, a dip, and fine noise. */
function series(frame: Frame): GradientPoint[] {
  const { n, stepMin, scale, seed } = FRAMES[frame];
  const start = Date.UTC(2026, 8, 27, 1, 0);
  return Array.from({ length: n }, (_, i) => {
    const v =
      1480 +
      520 * Math.sin(i / 7.5 + seed) +
      240 * Math.sin(i / 2.6 + seed * 2) +
      120 * Math.cos(i / 1.4) +
      60 * Math.sin(i * 1.9 + seed) +
      i * 11 -
      (i > 8 && i < 20 ? 420 * Math.sin(((i - 8) / 12) * Math.PI) : 0);
    return { t: start + i * stepMin * 60_000, value: Math.round(v * scale * 100) / 100 };
  });
}

function timeLabel(frame: Frame) {
  return (t: string | number | Date) => {
    const d = new Date(t);
    if (frame === "1h" || frame === "24h") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    if (frame === "1w") return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const axis = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { id: string; buyer: string; item: string; mode: "now" | "later" | "subscribe"; cents: number; pill: [string, "lime" | "purple" | "teal"] };

const ROWS: Row[] = [
  { id: "1", buyer: "0x4e2a…91bc", item: "Brand identity package", mode: "later", cents: 200_00, pill: ["Pay in 4", "purple"] },
  { id: "2", buyer: "0x9d11…07fa", item: "Workshop seat", mode: "now", cents: 75_00, pill: ["Paid", "lime"] },
  { id: "3", buyer: "0x31c8…5e44", item: "Social kit, monthly", mode: "subscribe", cents: 120_00, pill: ["Subscription", "teal"] },
];

/** The chart side: what the dashboard's Overview shows. */
export function SalesPreview({ extra = 0, rows = true, height = 340, className }: { extra?: number; rows?: boolean; height?: number; className?: string }) {
  const [frame, setFrame] = useState<Frame>("24h");
  const [type, setType] = useState<ChartType>("line");
  const data = useMemo(() => {
    const d = series(frame);
    if (!extra) return d;
    const last = d[d.length - 1]!;
    return [...d.slice(0, -1), { ...last, value: Math.round((last.value + extra / 100) * 100) / 100 }];
  }, [frame, extra]);
  const candles = useMemo(
    () =>
      Array.from({ length: Math.floor((data.length - 1) / 3) }, (_, i) => {
        const s = data.slice(i * 3, i * 3 + 4).map((p) => p.value);
        return { t: data[i * 3]!.t, o: s[0]!, c: s[s.length - 1]!, h: Math.max(...s), l: Math.min(...s) };
      }),
    [data],
  );
  const f = FRAMES[frame];
  const time = timeLabel(frame);

  return (
    <div className={cn("min-w-0", className)}>
      <PairHeader
        as="p"
        coins={[<PolarisCoin key="p" size={48} />, <DollarCoin key="d" size={48} />]}
        title="Sales / USD"
        trailing={<ChartTypeToggle value={type} onValueChange={setType} />}
      />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="ui-figure text-[34px] leading-none font-medium tracking-[-0.035em] sm:text-[42px]">{money(f.total + extra)}</span>
          <DeltaChip value={f.delta} suffix={frame === "24h" ? "today" : frame === "1h" ? "this hour" : frame === "1w" ? "this week" : "this month"} />
        </div>
        <TimeframeChips options={["1h", "24h", "1w", "1m"] as const} value={frame} onValueChange={setFrame} aria-label="Timeframe" />
      </div>
      <div className="mt-5">
        {type === "line" ? (
          <GradientLineChart
            key={frame}
            label="An invented studio's sales"
            data={data}
            height={height}
            formatValue={usd}
            formatAxis={axis}
            formatTime={time}
            formatBubbleNote={null}
            defaultIndex={extra ? data.length - 1 : undefined}
          />
        ) : (
          <CandlestickChart
            key={`${frame}-c`}
            label="An invented studio's sales, as candles"
            data={candles}
            height={height}
            formatPrice={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`)}
            formatTime={time}
            className="rounded-[20px]"
          />
        )}
      </div>
      {rows ? (
        <DataTable
          className="mt-6"
          caption="Recent payments, invented"
          columns={[
            {
              key: "buyer",
              header: "Customer",
              render: (r) => (
                <span className="flex min-w-0 items-center gap-3">
                  <ModeCoin mode={r.mode} text={r.item} />
                  <span className="ui-figure truncate font-medium">{r.buyer}</span>
                </span>
              ),
            },
            { key: "item", header: "Item", hideBelow: "md", render: (r) => <span className="block max-w-[200px] truncate">{r.item}</span> },
            { key: "amount", header: "Amount", render: (r) => <span className="ui-figure">{money(r.cents)}</span> },
            { key: "status", header: "Status", hideBelow: "sm", render: (r) => <StatusPill tone={r.pill[1]}>{r.pill[0]}</StatusPill> },
          ]}
          rows={ROWS}
          rowKey={(r) => r.id}
        />
      ) : null}
    </div>
  );
}

type Way = "now" | "later";

/** The widget side: one link, Pay now or Pay in 4, and what you receive. */
export function CheckoutWidgetPreview({ onPaid, className }: { onPaid?: (cents: number) => void; className?: string }) {
  const [way, setWay] = useState<Way>("later");
  const [amount, setAmount] = useState("200.00");
  const [paid, setPaid] = useState(0);
  const id = useId();
  const cents = parseAmount(amount);
  const valid = cents !== null && (way === "now" || cents >= 20_00);
  const q = cents && cents >= 20_00 ? payInFourQuote(cents) : null;
  const fee = cents ? Math.round((cents * 50) / 10_000) : 0;
  const receive = cents ? (way === "later" ? cents : cents - fee) : 0;

  const take = () => {
    if (!valid || !cents) return;
    setPaid((n) => n + 1);
    onPaid?.(cents);
  };

  return (
    <div className={cn("grid min-w-0 content-start gap-3", className)}>
      <div className="mb-2 flex min-h-10 items-center justify-between gap-3">
        <TextTabs
          size="auto"
          aria-label="How the buyer pays"
          options={[
            { value: "now", label: "Pay now" },
            { value: "later", label: "Pay in 4" },
          ]}
          value={way}
          onValueChange={setWay}
          tabId={(v) => `${id}-tab-${v}`}
          panelId={() => `${id}-panel`}
        />
        <div className="flex gap-2">
          <IconSquareButton
            label="Start the preview again"
            icon={<RotateCcw />}
            onClick={() => {
              setAmount("200.00");
              setWay("later");
              setPaid(0);
              onPaid?.(0);
            }}
          />
          <IconSquareButton label="Open the demo shop (a new tab)" icon={<Store />} onClick={() => window.open(DEMO_SHOP_URL, "_blank", "noopener,noreferrer")} />
        </div>
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${way}`} className="grid min-w-0 gap-3">
        <SwapStack
          top={
            <SwapCard
              coin={<DollarCoin size={42} />}
              symbol="USD"
              caption="You charge"
              value={amount}
              onValueChange={setAmount}
              inputLabel="Order amount, in dollars"
              invalid={amount.trim() !== "" && !valid}
              metaLabel="Your fee"
              meta={way === "later" ? "$0.00" : "0.5%"}
            />
          }
          toggle={<SwapToggle label={way === "later" ? "Switch to Pay now" : "Switch to Pay in 4"} onClick={() => setWay(way === "later" ? "now" : "later")} />}
          bottom={
            <SwapCard
              coin={<PolarisCoin size={42} />}
              symbol="Buyer pays"
              caption={way === "later" ? "Pay in 4" : "Pay now"}
              amount={way === "later" ? (q ? `4 × ${(q.each / 100).toFixed(2)}` : "From 20.00") : cents ? (cents / 100).toFixed(2) : "0.00"}
              metaLabel={way === "later" ? "APR" : "Settles in"}
              meta={way === "later" ? "10%" : "0.8 s"}
            />
          }
        />
        <PrimaryButton size="lg" block className="mt-1" icon={<Zap />} disabled={!valid} onClick={take}>
          {way === "later" ? "Pay in 4 as the buyer" : "Pay now as the buyer"}
        </PrimaryButton>
        <SecondaryButton asChild size="lg" block iconRight={<Store />}>
          <a href={DEMO_SHOP_URL} target="_blank" rel="noreferrer">
            See the demo shop
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </SecondaryButton>
        <div className="relative">
          <BalanceSummaryCard
            label="You receive"
            value={money(receive)}
            badge={
              <StatusPill tone="lime" size="sm">
                {way === "later" ? "100% at checkout" : "In 0.8 s"}
              </StatusPill>
            }
            stats={[
              { label: "Your fee", value: way === "later" ? "$0.00" : money(fee) },
              { label: "Buyer pays", value: way === "later" ? (q ? money(q.total) : "—") : money(cents ?? 0) },
              { label: "Settles in", value: "0.8 s" },
            ]}
          />
          <AnimatePresence>
            {paid ? (
              <motion.p
                key={paid}
                role="status"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute -top-4 right-4 flex items-center gap-2 rounded-full bg-white py-1.5 pr-3.5 pl-1.5 text-[13px] font-semibold text-[#121418] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)]"
              >
                <span className="grid size-6 place-items-center rounded-full bg-ui-lime-button">
                  <Check size={13} strokeWidth={2.75} aria-hidden />
                </span>
                +{money(receive)} settled
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** The two side by side, as on the Overview: the hero's product visual. */
export function ProductPreview({ className }: { className?: string }) {
  const [extra, setExtra] = useState(0);
  return (
    <div
      aria-label="A live preview of the Polaris for Business dashboard, with an invented studio"
      role="group"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-x-11 gap-y-10 rounded-[32px] border border-ui-hairline-strong p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_356px] xl:grid-cols-[minmax(0,1fr)_392px] xl:p-10",
        className,
      )}
    >
      <SalesPreview extra={extra} />
      <CheckoutWidgetPreview onPaid={(c) => setExtra((e) => (c ? e + c : 0))} />
    </div>
  );
}
