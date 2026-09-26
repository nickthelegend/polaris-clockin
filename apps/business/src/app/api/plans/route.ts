import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { merchantFor } from "@/server/services";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/** The Pay in 4 ledger: every plan this merchant originated. */
export const GET = withMerchant(async (_req, auth) => {
  const merchant = await merchantFor(auth);
  return ok(await getStore().listPlans(merchant.id));
});
