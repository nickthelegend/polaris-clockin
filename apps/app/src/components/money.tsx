"use client";

import { useEffect, useRef, useState } from "react";
import { type Micros, toNumber, usd, usdParts } from "@/lib/money";
import { useLocalCurrency } from "@/lib/prefs";
import { cx } from "./ui";

/** "+ $1,000.00" in green or "− $60.46" in red; the sign carries it, not only colour. */
export function SignedAmount({
  amount,
  direction,
  className,
}: {
  amount: Micros;
  direction: "in" | "out";
  className?: string;
}) {
  return (
    <span className={cx("tabular font-medium whitespace-nowrap", direction === "in" ? "text-positive" : "text-negative", className)}>
      {direction === "in" ? "+" : "−"} {usd(amount)}
    </span>
  );
}

/** "≈ 1.518.279 ARS": the local-currency line under a dollar figure. */
export function LocalEquivalent({ amount, className }: { amount: Micros; className?: string }) {
  const local = useLocalCurrency();
  const text = local?.format(amount);
  if (!text) return null;
  return (
    <span className={cx("tabular text-muted", className)}>
      <span className="sr-only">About </span>
      <span aria-hidden>≈ </span>
      {text}
    </span>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The balance, counting up on first paint (600ms, ease-out). The cents sit a
 * step quieter. Reduced motion shows the figure straight away.
 */
export function BalanceFigure({ amount, className }: { amount: Micros; className?: string }) {
  const target = toNumber(amount);
  const [shown, setShown] = useState<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!first.current || reduce) {
      setShown(null);
      return;
    }
    first.current = false;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      setShown(target * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setShown(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const value = shown === null ? amount : BigInt(Math.round(shown * 1e6));
  const { whole, cents } = usdParts(value);
  return (
    <span className={cx("tabular font-display font-bold tracking-[-0.045em]", className)}>
      <span className="sr-only">{usd(amount)}</span>
      <span aria-hidden>
        {whole}
        <span className="opacity-90">{cents}</span>
      </span>
    </span>
  );
}
