import type { Metadata } from "next";

import { PlansView } from "./plans-view";

export const metadata: Metadata = { title: "Pay in 4" };

export default function PlansPage() {
  return <PlansView />;
}
