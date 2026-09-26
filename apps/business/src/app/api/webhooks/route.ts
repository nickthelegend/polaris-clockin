import { withMerchant } from "@/server/auth";
import { ok, readJson } from "@/server/http";
import { createWebhook, listWebhooks } from "@/server/services";
import { parseCreateWebhook } from "@/server/validate";

export const dynamic = "force-dynamic";

/** Webhook endpoints and the delivery log. */
export const GET = withMerchant(async (_req, auth) => ok(await listWebhooks(auth)));

/** Register an endpoint. The response carries its signing secret once. */
export const POST = withMerchant(async (req, auth) => {
  const input = parseCreateWebhook(await readJson(req));
  return ok(await createWebhook(auth, input), 201);
});
