import type { ReactNode } from "react";
import { TabBar } from "@/components/tab-bar";

export default function TabsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
