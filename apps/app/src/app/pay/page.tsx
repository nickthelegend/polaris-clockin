import type { Metadata } from "next";
import { Scan } from "./scan";

export const metadata: Metadata = { title: "Pay" };

export default function PayPage() {
  return <Scan />;
}
