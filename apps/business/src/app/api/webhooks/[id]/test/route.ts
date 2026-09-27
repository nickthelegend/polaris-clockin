import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { sendTestEvent } from "@/server/services";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Send a signed test `payment.succeeded` (livemode false) to one of the
 * caller's endpoints, exactly as live events are sent, and return the
 * delivery with the endpoint's answer.
 */
export const POST = withMerchant<Ctx>(async (_req, auth, { params }) => {
  const { id } = await params;
  return ok(await sendTestEvent(auth, id), 201);
});
