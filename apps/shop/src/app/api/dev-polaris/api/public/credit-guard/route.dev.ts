import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";

export const dynamic = "force-dynamic";

/**
 * Dev mock of GET /api/public/credit-guard. The mock has no chain and no
 * risk guard, so it says so ("unconfigured"): Pay in 4 stays on. The paused
 * state is shown against the real API (`pnpm demo:local`).
 */
export async function GET() {
  if (!devMockEnabled()) return notFound();
  const readAt = new Date().toISOString();
  return Response.json({ data: { state: "unconfigured", paused: false, reasons: [], message: null, checkedAt: null, ageSeconds: null, readAt } });
}
