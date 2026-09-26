import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { retryDelivery } from "@/server/services";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Retry one delivery now, from the delivery log. */
export const POST = withMerchant<Ctx>(async (_req, auth, { params }) => {
  const { id } = await params;
  return ok(await retryDelivery(auth, id));
});
