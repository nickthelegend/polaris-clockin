import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { merchantFor } from "@/server/services";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/** Every payment, newest first. "Succeeded" only ever comes from indexed chain events. */
export const GET = withMerchant(async (_req, auth) => {
  const merchant = await merchantFor(auth);
  return ok(await getStore().listPayments(merchant.id));
});
