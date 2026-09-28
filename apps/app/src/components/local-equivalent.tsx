"use client";

import { cn } from "@polaris/ui";
import { type Micros, SAMPLE_FX_AS_OF } from "@/lib/money";
import { useLocalCurrency } from "@/lib/prefs";

/**
 * "≈ 1.518.279 ARS · sample rate": the local-currency line under a dollar
 * figure, for reading only. The rates are fixed samples (money.ts), and the
 * line says so; nothing for dollar locales.
 */
export function LocalEquivalent({ amount, className }: { amount: Micros; className?: string }) {
  const local = useLocalCurrency();
  const text = local?.format(amount);
  if (!text) return null;
  return (
    <span className={cn("ui-figure text-ui-muted", className)} title={`Indicative only: a sample exchange rate from ${SAMPLE_FX_AS_OF}, not a live quote.`}>
      <span className="sr-only">About </span>
      <span aria-hidden>≈ </span>
      {text}
      <span className="text-[0.85em]"> · sample rate</span>
    </span>
  );
}
