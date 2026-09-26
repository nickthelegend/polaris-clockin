import { appendSdkLog, getOrder } from "@/lib/orders/service";
import { requestOrigin } from "@/lib/origin";
import { retrieveCheckoutSession } from "@/lib/polaris";

export const dynamic = "force-dynamic";

/**
 * The order, for the receipt page to poll. `?sync=1` also asks Polaris for
 * the session (sessions.retrieve) to show whether the buyer finished; the
 * order itself still only changes on a verified webhook.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order = await getOrder(id);
  if (!order) return Response.json({ error: { code: "not_found", message: "No such order." } }, { status: 404 });

  let session: { status: string; mode: string | null } | null = null;
  if (new URL(req.url).searchParams.get("sync") === "1" && order.payment.sessionId) {
    try {
      const retrieved = await retrieveCheckoutSession(order.payment.sessionId, requestOrigin(req));
      session = { status: retrieved.session.status, mode: retrieved.session.payment?.mode ?? null };
      order = (await appendSdkLog(order.id, [retrieved.log])) ?? order;
    } catch {
      session = null;
    }
  }
  return Response.json({ order, session }, { headers: { "cache-control": "no-store" } });
}
