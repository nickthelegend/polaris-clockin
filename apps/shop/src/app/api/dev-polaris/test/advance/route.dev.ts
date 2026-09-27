import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { advanceSession, deliver, findSessionByOrder } from "@/lib/dev-polaris/mock";
import { canRead, payRefOf, tokenFromRequest } from "@/lib/orders/access";
import { getOrder } from "@/lib/orders/service";

export const dynamic = "force-dynamic";

/**
 * Dev tool behind the "Built with Polaris" drawer: collect the next Pay in 4
 * instalment, charge the next subscription period, or cancel the
 * subscription, for an order, and send the webhooks Polaris would. Only the
 * browser that placed the order may.
 */
export async function POST(req: Request) {
  if (!devMockEnabled()) return notFound();
  const body = (await req.json().catch(() => ({}))) as { orderId?: string; action?: string };
  const order = body.orderId ? await getOrder(body.orderId) : null;
  if (!order || !canRead(order, tokenFromRequest(req, order.id))) {
    return Response.json({ error: { message: "That isn't an order from this browser." } }, { status: 404 });
  }
  // The mock knows the order by the payRef the shop gave its session.
  const session = findSessionByOrder(payRefOf(order));
  if (!session) return Response.json({ error: { message: "That order wasn't paid through the test checkout." } }, { status: 404 });
  const result = advanceSession(session.id, body.action === "cancel" ? "cancel" : "next");
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: 409 });
  const deliveries = await deliver(result.events, session.webhookUrl, undefined, session.id);
  return Response.json({ deliveries });
}
