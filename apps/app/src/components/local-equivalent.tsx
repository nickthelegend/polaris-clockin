"use client";

import { cn } from "@polaris/ui";
import type { Micros } from "@/lib/money";
import { useLocalCurrency } from "@/lib/prefs";

/** "≈ 1.518.279 ARS": the local-currency line under a dollar figure. Nothing for dollar locales. */
export function LocalEquivalent({ amount, className }: { amount: Micros; className?: string }) {
  const local = useLocalCurrency();
  const text = local?.format(amount);
  if (!text) return null;
  return (
    <span className={cn("ui-figure text-ui-muted", className)}>
      <span className="sr-only">About </span>
      <span aria-hidden>≈ </span>
      {text}
    </span>
  );
}
