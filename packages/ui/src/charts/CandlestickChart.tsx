"use client";

import { CandlestickChart as CandlesIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { useControllable } from "../lib/hooks";
import { niceTicks, useSize } from "./geometry";

export type Candle = {
  /** The period: an ISO date, a timestamp or a label. */
  t: string | number | Date;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type CandlestickChartProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  data: Candle[];
  /** Total height including the chip row. */
  height?: number;
  /** The dashed lime line and tag; defaults to the last close. `null` hides it. */
  lastPrice?: number | null;
  /** The dashed purple line and tag (a target, an average, a limit). */
  reference?: { value: number; label?: string } | null;
  /** Timeframe chips ("5m 15m 30m 5h"); omit to hide the row's chips. */
  timeframes?: string[];
  timeframe?: string;
  defaultTimeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  /** Something on the chip row's left, like ref C's "Price ▾" select. */
  leading?: ReactNode;
  /** Shows ref C's candles button at the right of the chip row. */
  onTypeToggle?: () => void;
  formatPrice?: (v: number) => string;
  formatTime?: (t: Candle["t"]) => string;
  /** What the chart shows, for screen readers. */
  label: string;
  animate?: boolean;
};

// A theme can recolour the bodies (ref E: lime up, orange down).
const UP = "var(--ui-candle-up, var(--ui-lime-bright))";
const DOWN = "var(--ui-candle-down, var(--ui-purple-deep))";
const AXIS_W = 52;
const CHIP_ROW = 52;

function defaultTime(t: Candle["t"]): string {
  const d = t instanceof Date ? t : typeof t === "number" ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Ref C's candles: lime up and purple-deep down bodies with wicks on the
 * dark panel, a dashed last-price line with a lime tag, a purple reference
 * tag, a right-hand price axis, timeframe chips, a crosshair with a readout
 * on hover, drag and arrow keys, and a draw-in.
 *
 * ```tsx
 * <CandlestickChart
 *   label="Daily payment volume"
 *   data={candles}
 *   timeframes={["1D", "1W", "1M", "3M"]}
 *   reference={{ value: 97.45 }}
 * />
 * ```
 */
export function CandlestickChart({
  data,
  height = 340,
  lastPrice,
  reference = null,
  timeframes,
  timeframe,
  defaultTimeframe,
  onTimeframeChange,
  leading,
  onTypeToggle,
  formatPrice = (v) => v.toFixed(2),
  formatTime = defaultTime,
  label,
  animate = true,
  className,
  style,
  ...props
}: CandlestickChartProps) {
  const reduced = useReducedMotion();
  const [ref, size] = useSize<HTMLDivElement>();
  const [tf, setTf] = useControllable<string | undefined>({
    value: timeframe,
    defaultValue: defaultTimeframe ?? timeframes?.[timeframes.length - 1],
    onChange: onTimeframeChange as (v: string | undefined) => void,
  });
  const [cross, setCross] = useState<{ i: number; y: number | null } | null>(null);

  const hasRow = Boolean(timeframes?.length || leading || onTypeToggle);
  const plotH = height - (hasRow ? CHIP_ROW : 0);
  const W = size.width;
  const plotW = Math.max(0, W - AXIS_W);
  const n = data.length;
  const slot = n ? plotW / n : 0;
  const bodyW = Math.max(2, Math.min(18, slot * 0.62));

  const last = lastPrice === undefined ? data[n - 1]?.c : lastPrice;
  const lows = data.map((d) => d.l);
  const highs = data.map((d) => d.h);
  let lo = Math.min(...lows, ...(last != null ? [last] : []), ...(reference ? [reference.value] : []));
  let hi = Math.max(...highs, ...(last != null ? [last] : []), ...(reference ? [reference.value] : []));
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const top = 10;
  const bottom = 10;
  const y = (v: number) => top + (plotH - top - bottom) * (1 - (v - lo) / (hi - lo));
  const priceAt = (py: number) => lo + (1 - (py - top) / (plotH - top - bottom)) * (hi - lo);
  const ticks = n ? niceTicks(lo, hi, 6).filter((t) => t > lo && t < hi) : [];
  const vEvery = Math.max(1, Math.round(n / 6));

  const tagYs = [last != null ? y(last) : null, reference ? y(reference.value) : null].filter((v): v is number => v !== null);
  const clashes = (ty: number) => tagYs.some((t) => Math.abs(t - ty) < 14);

  const locate = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !n) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const i = Math.max(0, Math.min(n - 1, Math.floor(px / slot)));
    setCross({ i, y: Math.max(top, Math.min(plotH - bottom, py)) });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setCross((c) => ({ i: Math.max(0, Math.min(n - 1, (c?.i ?? (step > 0 ? -1 : n)) + step)), y: null }));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setCross({ i: e.key === "Home" ? 0 : n - 1, y: null });
    } else if (e.key === "Escape") setCross(null);
  };

  const active = cross ? data[cross.i] : null;
  const crossY = cross ? (cross.y ?? (active ? y(active.c) : null)) : null;
  // Draw in once: a later remount (a resize that re-measures) shows the chart at rest.
  const drawn = useRef(false);
  const measured = W > 0 && n > 0;
  useEffect(() => {
    if (measured) drawn.current = true;
  }, [measured]);
  const reveal = animate && !reduced && !drawn.current;
  const first = data[0];
  const change = first && last != null ? ((last - first.o) / first.o) * 100 : 0;

  return (
    <div
      data-theme="dark"
      className={cn("relative overflow-hidden rounded-ui-tile bg-ui-candle-panel font-satoshi text-white", className)}
      style={{ height, ...style }}
      {...props}
    >
      {hasRow ? (
        <div className="flex h-[52px] items-center gap-1 px-3">
          {leading}
          {timeframes?.length ? (
            <div role="radiogroup" aria-label="Timeframe" className="flex items-center gap-0.5">
              {timeframes.map((t) => {
                const on = t === tf;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTf(t)}
                    className={cn(
                      "h-9 rounded-full px-3.5 text-[14px] leading-none font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-lime-bright",
                      on ? "bg-ui-candle-chip text-white" : "text-white/80 hover:text-white",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex-1" />
          {onTypeToggle ? (
            <button
              type="button"
              aria-label="Switch chart type"
              title="Switch chart type"
              onClick={onTypeToggle}
              className="grid size-9 place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ui-lime-bright"
            >
              <CandlesIcon aria-hidden size={20} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={ref}
        role="img"
        tabIndex={0}
        aria-label={`${label}. ${n} periods, last ${last != null ? formatPrice(last) : "none"}, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}%. Use the arrow keys to read each period.`}
        onPointerMove={locate}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          locate(e);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setCross(null);
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "mouse") setCross(null);
        }}
        onKeyDown={onKey}
        onBlur={() => setCross(null)}
        className="relative cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-lime-bright"
        style={{ height: plotH }}
      >
        {W > 0 && n > 0 ? (
          <svg width={W} height={plotH} className="absolute inset-0" aria-hidden>
            {/* grid */}
            {ticks.map((t) => (
              <line key={`h${t}`} x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--ui-candle-grid)" strokeWidth={1} />
            ))}
            {data.map((_, i) =>
              i > 0 && i % vEvery === 0 ? (
                <line key={`v${i}`} x1={i * slot} x2={i * slot} y1={0} y2={plotH} stroke="var(--ui-candle-grid)" strokeWidth={1} />
              ) : null,
            )}
            <line x1={plotW} x2={plotW} y1={0} y2={plotH} stroke="var(--ui-candle-grid)" strokeWidth={1} />

            {/* axis */}
            {ticks.map((t) =>
              clashes(y(t)) || (crossY !== null && Math.abs(crossY - y(t)) < 14) ? null : (
                <text
                  key={`a${t}`}
                  x={plotW + AXIS_W / 2}
                  y={y(t)}
                  dy="0.35em"
                  textAnchor="middle"
                  fill="var(--ui-candle-axis)"
                  fontSize="13"
                  className="ui-figure"
                >
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              ),
            )}

            {/* candles */}
            {data.map((d, i) => {
              const cx = slot * (i + 0.5);
              const up = d.c >= d.o;
              const color = up ? UP : DOWN;
              const yTop = y(Math.max(d.o, d.c));
              const yBot = y(Math.min(d.o, d.c));
              const dim = cross !== null && cross.i !== i;
              return (
                <motion.g
                  key={i}
                  initial={reveal ? { scaleY: 0, opacity: 0 } : false}
                  animate={{ scaleY: 1, opacity: dim ? 0.55 : 1 }}
                  transition={{
                    scaleY: { delay: reveal ? i * (0.6 / n) : 0, type: "spring", stiffness: 260, damping: 26 },
                    opacity: { duration: 0.2, delay: reveal && !cross ? i * (0.6 / n) : 0 },
                  }}
                  style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
                >
                  <line x1={cx} x2={cx} y1={y(d.h)} y2={y(d.l)} stroke={color} strokeWidth={1.5} />
                  <rect
                    x={cx - bodyW / 2}
                    y={yTop}
                    width={bodyW}
                    height={Math.max(2, yBot - yTop)}
                    rx={1}
                    fill={color}
                  />
                </motion.g>
              );
            })}

            {/* last price and reference lines */}
            {last != null ? (
              <line x1={0} x2={plotW} y1={y(last)} y2={y(last)} stroke={UP} strokeWidth={1.25} strokeDasharray="4 4" />
            ) : null}
            {reference ? (
              <line
                x1={0}
                x2={plotW}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke={DOWN}
                strokeWidth={1.25}
                strokeDasharray="4 4"
              />
            ) : null}

            {/* crosshair */}
            {cross && active && crossY !== null ? (
              <g>
                <line
                  x1={slot * (cross.i + 0.5)}
                  x2={slot * (cross.i + 0.5)}
                  y1={0}
                  y2={plotH}
                  stroke="#ffffff"
                  strokeOpacity={0.55}
                  strokeDasharray="3 4"
                />
                <line x1={0} x2={plotW} y1={crossY} y2={crossY} stroke="#ffffff" strokeOpacity={0.55} strokeDasharray="3 4" />
              </g>
            ) : null}
          </svg>
        ) : null}

        {/* tags */}
        {W > 0 && last != null ? <PriceTag y={y(last)} tone="lime" text={formatPrice(last)} /> : null}
        {W > 0 && reference ? <PriceTag y={y(reference.value)} tone="purple" text={reference.label ?? formatPrice(reference.value)} /> : null}
        {W > 0 && cross && crossY !== null ? <PriceTag y={crossY} tone="white" text={formatPrice(priceAt(crossY))} /> : null}

        {/* readout */}
        {active ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-2 left-2 flex items-center gap-2.5 rounded-[10px] bg-black/55 px-2.5 py-1.5 text-[12px] leading-none backdrop-blur-md"
          >
            <span className="text-white/60">{formatTime(active.t)}</span>
            {(["o", "h", "l", "c"] as const).map((k) => (
              <span key={k} className="ui-figure">
                <span className="mr-1 text-white/50 uppercase">{k}</span>
                <span className={k === "c" ? (active.c >= active.o ? "text-[var(--ui-candle-up,var(--ui-lime-bright))]" : "text-[var(--ui-candle-down,#a883ff)]") : "text-white"}>
                  {formatPrice(active[k])}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PriceTag({ y, tone, text }: { y: number; tone: "lime" | "purple" | "white"; text: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ui-figure pointer-events-none absolute right-1.5 z-[1] -translate-y-1/2 rounded-full px-2 py-[5px] text-[13px] leading-none font-semibold",
        tone === "lime" && "bg-ui-lime-bright text-[#13141f]",
        tone === "purple" && "bg-ui-purple-deep text-white",
        tone === "white" && "bg-white text-[#13141f]",
      )}
      style={{ top: y }}
    >
      {text}
    </span>
  );
}
