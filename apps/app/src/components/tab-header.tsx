import type { ReactNode } from "react";
import { cx, SCREEN_TOP } from "./ui";

/** Title row for the tab screens: the title left, one action right, in the reference's header slot. */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className={cx("flex items-center justify-between gap-3", SCREEN_TOP)}>
      <h1 className="flex h-[41px] items-center font-display text-[28px] leading-none font-semibold tracking-[-0.05em]">
        {title}
      </h1>
      <div className="flex items-center gap-[9px]">{right}</div>
    </header>
  );
}
