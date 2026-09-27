import type { Metadata } from "next";
import { Suspense } from "react";
import { Insights } from "@/screens/insights";
import { PlanRoute } from "@/sheets/plan";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Plan" };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return (
    <>
      <Suspense>
        <Insights />
      </Suspense>
      <PlanRoute id={id} cold />
    </>
  );
}
