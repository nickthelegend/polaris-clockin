import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { advanceSession, deliver, findSessionByOrder } from "@/lib/dev-polaris/mock";

export const dynamic = "force-dynamic";

/**
 * Dev tool behind the "Built with Polaris" drawer: collect the next Pay in 4
 * instalment, or charge the next subscription period, for an order, and send
 * the webhooks Polaris would.
 */
export async function POST(req: Request) {
  if (!devMockEnabled()) return notFound();
  const body = (await req.json().catch(() => ({}))) as { orderId?: string };
  const session = body.orderId ? findSessionByOrder(body.orderId) : null;
  if (!session) return Response.json({ error: { message: "That order wasn't paid through the test checkout." } }, { status: 404 });
  const result = advanceSession(session.id);
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: 409 });
  const deliveries = await deliver(result.events, session.webhookUrl, undefined, session.id);
  return Response.json({ deliveries });
}
