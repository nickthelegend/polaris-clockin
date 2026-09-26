import type { ReactNode } from "react";

/** Title row for the tab screens: big title left, one action right. */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex h-12 items-center justify-between gap-3">
      <h1 className="font-display text-[30px] leading-none font-bold tracking-[-0.045em]">{title}</h1>
      <div className="flex items-center gap-2.5">{right}</div>
    </header>
  );
}
