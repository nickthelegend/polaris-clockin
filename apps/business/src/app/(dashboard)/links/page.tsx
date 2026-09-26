import type { Metadata } from "next";

import { LinksView } from "./links-view";

export const metadata: Metadata = { title: "Payment links" };

export default function LinksPage() {
  return <LinksView />;
}
