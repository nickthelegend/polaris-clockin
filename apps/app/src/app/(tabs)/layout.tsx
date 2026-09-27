import type { ReactNode } from "react";
import { FirstRun } from "@/components/shell/first-run";
import { TabBar } from "@/components/shell/tab-bar";

/** The five tabs: full screens under the floating nav. Everything else is a sheet over them. */
export default function TabsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TabBar />
      <FirstRun />
    </>
  );
}
