import { recordEvent } from "@/lib/orders/service";
import { requestOrigin } from "@/lib/origin";
import { PolarisSignatureVerificationError, verifyWebhook, type PolarisEvent } from "@/lib/polaris";

export const dynamic = "force-dynamic";

/**
 * Polaris webhooks: the only way an order becomes "paid".
 *
 * 1. Read the raw body; the signature covers the exact bytes.
 * 2. polaris.webhooks.verify() checks the HMAC and the timestamp (the replay window).
 * 3. The event id is recorded, so a redelivery changes nothing.
 * 4. The order moves forward if the event matches it (amount, currency).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: PolarisEvent;
  try {
    event = verifyWebhook(raw, req.headers.get("polaris-signature"), requestOrigin(req));
  } catch (e) {
    if (e instanceof PolarisSignatureVerificationError) {
      console.warn(`[webhook] Rejected a delivery: ${e.reason}`);
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    console.error("[webhook] Not configured", e);
    return Response.json({ error: "webhooks aren't configured" }, { status: 503 });
  }

  const result = await recordEvent(event);
  if (result.outcome === "flagged") {
    console.warn(`[webhook] ${event.type} ${event.id} flagged order ${result.orderId}: ${result.reason}`);
  }
  return Response.json({ received: true, outcome: result.outcome }, { status: result.status });
}
