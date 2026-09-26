import type { Metadata } from "next";
import { Plans } from "./plans";

export const metadata: Metadata = { title: "Plans" };

export default function PlansPage() {
  return <Plans />;
}
