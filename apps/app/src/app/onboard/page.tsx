import type { Metadata } from "next";
import { Suspense } from "react";
import { preload } from "react-dom";
import { Onboarding } from "@/screens/onboarding";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardPage() {
  // The first page's animation starts downloading with the page, not after it.
  preload("/lottie/onboarding-1.json", { as: "fetch", crossOrigin: "anonymous" });
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
