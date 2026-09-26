"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { formatUsd, quotePayIn4, toCents, type AmountInput, type PayIn4Quote } from "../money.js";
import { PolarisMark } from "./PolarisMark.js";
import { PolarisStyles } from "./styles.js";

export type PolarisMessagingProps = {
  /** The product or cart price: "201.50". */
  amount: AmountInput;
  /** Buyer APR in basis points. Default 1000 (10%, the loan engine's rate). 0 reads "interest-free". */
  aprBps?: number;
  /** Seconds between instalments. Default one week. */
  intervalSeconds?: number;
  /** Hide the badge outside this range. Defaults: $1.00 to $5,000.00 (the top credit tier). */
  minAmount?: AmountInput;
  maxAmount?: AmountInput;
  /** Popover colours: "light" (default) or "dark". The sentence itself inherits your text colour. */
  theme?: "light" | "dark";
  /** Which edge the popover lines up with. Default "start". */
  align?: "start" | "end";
  className?: string;
  style?: CSSProperties;
};

function describeWait(seconds: number, index: number): string {
  if (index === 0) return "Today";
  const total = seconds * index;
  const week = 7 * 86_400;
  const day = 86_400;
  if (total % week === 0) {
    const n = total / week;
    return n === 1 ? "In 1 week" : `In ${n} weeks`;
  }
  if (total % day === 0) {
    const n = total / day;
    return n === 1 ? "Tomorrow" : `In ${n} days`;
  }
  const minutes = Math.max(1, Math.round(total / 60));
  return minutes === 1 ? "In 1 min" : `In ${minutes} min`;
}

function cadence(seconds: number): string {
  const week = 7 * 86_400;
  if (seconds === week) return "every week";
  if (seconds % week === 0) return `every ${seconds / week} weeks`;
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "every day" : `every ${seconds / 86_400} days`;
  return `every ${Math.max(1, Math.round(seconds / 60))} minutes`;
}

function inRange(amount: AmountInput, min: AmountInput, max: AmountInput): boolean {
  try {
    const cents = toCents(amount);
    return cents >= toCents(min) && cents <= toCents(max);
  } catch {
    return false;
  }
}

/** "$50.38" with the dollar sign dimmed, the design system's money style. */
function Money({ value }: { value: string }) {
  const text = formatUsd(toCents(value));
  return (
    <>
      <span className="plrs-hero__dim">{text.slice(0, 1)}</span>
      {text.slice(1)}
    </>
  );
}

/**
 * The product-page line: "or 4 payments of $50.38 with ✦ Polaris · Learn more".
 * "Learn more" opens a popover with the schedule, the interest, and how it works.
 * Renders nothing when the amount is outside the range Pay in 4 serves.
 */
export function PolarisMessaging({
  amount,
  aprBps,
  intervalSeconds,
  minAmount = "1.00",
  maxAmount = "5000.00",
  theme = "light",
  align = "start",
  className,
  style,
}: PolarisMessagingProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const quote: PayIn4Quote | null = useMemo(() => {
    if (!inRange(amount, minAmount, maxAmount)) return null;
    try {
      return quotePayIn4(amount, { aprBps, intervalSeconds });
    } catch {
      return null;
    }
  }, [amount, aprBps, intervalSeconds, minAmount, maxAmount]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  if (!quote) return null;

  const count = quote.installments.length;
  const each = formatUsd(toCents(quote.each));

  return (
    <div ref={rootRef} className={className ? `plrs-root plrs-msg ${className}` : "plrs-root plrs-msg"} data-theme={theme} style={style}>
      <PolarisStyles />
      <span>
        or {count} {quote.interestFree ? "interest-free payments" : "payments"} of <strong>{each}</strong> with{" "}
        <span className="plrs-brand">
          <PolarisMark />
          Polaris
        </span>
        <button
          ref={triggerRef}
          type="button"
          className="plrs-link"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => (open ? close(true) : setOpen(true))}
        >
          Learn more<span className="plrs-sr"> about paying in {count} with Polaris</span>
        </button>
      </span>

      {open ? (
        <div
          ref={popoverRef}
          id={popoverId}
          className="plrs-pop"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-align={align}
        >
          <div className="plrs-pop__head">
            <PolarisMark />
            <h2 className="plrs-pop__title" id={titleId}>
              Pay in {count} with Polaris
            </h2>
            <button type="button" className="plrs-close" aria-label="Close" onClick={() => close(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <p className="plrs-hero">
            {count} × <Money value={quote.each} />
          </p>
          <p className="plrs-sub">
            {quote.interestFree
              ? `${formatUsd(toCents(quote.total))} in total, no interest.`
              : `${formatUsd(toCents(quote.total))} in total, including ${formatUsd(toCents(quote.interest))} interest (${quote.aprBps / 100}% APR).`}
          </p>

          <ol className="plrs-sched" style={{ ["--plrs-n" as string]: String(Math.min(count, 6)) }} aria-label="Payment schedule">
            {quote.installments.slice(0, 6).map((row) => (
              <li key={row.index}>
                <span className="plrs-tick" aria-hidden="true" />
                <span className="plrs-when">{describeWait(quote.intervalSeconds, row.index - 1)}</span>
                <span className="plrs-amt">{formatUsd(toCents(row.amount))}</span>
              </li>
            ))}
          </ol>

          <ol className="plrs-steps">
            <li>Choose Polaris at checkout, then Pay in {count}.</li>
            <li>Continue with Face ID. No app to install, no password, no seed phrase.</li>
            <li>
              Pay {formatUsd(toCents(quote.installments[0]!.amount))} today. The rest is collected {cadence(quote.intervalSeconds)}, automatically.
            </li>
          </ol>

          <p className="plrs-fine">
            Pay in {count} runs on your Polaris credit line, scored on chain with the reasons shown to you. Opening lines run from $200 to
            $1,000 and grow as you repay on time. The merchant is paid in full today, in dollars (AUSD) on Monad.
          </p>
        </div>
      ) : null}
    </div>
  );
}
