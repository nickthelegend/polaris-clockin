import type { Metadata } from "next";
import { Suspense } from "react";
import { Onboard } from "./onboard";

export const metadata: Metadata = { title: "Create your account" };

export default function OnboardPage() {
  return (
    <Suspense>
      <Onboard />
    </Suspense>
  );
}
