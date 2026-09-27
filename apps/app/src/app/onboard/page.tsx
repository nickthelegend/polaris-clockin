import type { Metadata } from "next";
import { Suspense } from "react";
import { Onboarding } from "@/screens/onboarding";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
