import { withMerchant } from "@/server/auth";
import { ok, readJson, methodNotAllowed } from "@/server/http";
import { merchantFor } from "@/server/services";
import { getStore } from "@/server/store";
import { parseBusinessName } from "@/server/validate";

export const dynamic = "force-dynamic";

/** The signed-in merchant: business name, payout wallet, email. */
export const GET = withMerchant(async (_req, auth) => ok(await merchantFor(auth)));

/** Onboarding and settings: set the business name. */
export const POST = withMerchant(async (req, auth) => {
  const { businessName } = parseBusinessName(await readJson(req));
  const merchant = await merchantFor(auth);
  // TODO(registry): on first naming, call MerchantRegistry.registerFor from the
  // registry server wallet (plan §5.2 item 9) so the merchant never holds MON.
  return ok(await getStore().updateMerchant(merchant.id, { businessName }));
});

/* Everything else answers a JSON 405 naming what the route accepts. */
const notAllowed = methodNotAllowed(["GET", "POST"]);
export const PUT = withMerchant(notAllowed);
export const PATCH = withMerchant(notAllowed);
export const DELETE = withMerchant(notAllowed);
