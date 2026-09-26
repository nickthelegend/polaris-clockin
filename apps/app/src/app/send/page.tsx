import type { Metadata } from "next";
import { Suspense } from "react";
import { Send } from "./send";

export const metadata: Metadata = { title: "Send money" };

export default function SendPage() {
  return (
    <Suspense>
      <Send />
    </Suspense>
  );
}
