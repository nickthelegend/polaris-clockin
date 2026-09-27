import { redirect } from "next/navigation";

/** Plans live under Insights now (Expenses | Plans). */
export default function PlansPage() {
  redirect("/insights?view=plans");
}
