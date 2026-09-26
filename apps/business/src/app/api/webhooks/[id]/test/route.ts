import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { sendTestEvent } from "@/server/services";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Sign and log a test `payment.succeeded` event for one of the caller's endpoints. */
export const POST = withMerchant<Ctx>(async (_req, auth, { params }) => {
  const { id } = await params;
  return ok(await sendTestEvent(auth, id), 201);
});
