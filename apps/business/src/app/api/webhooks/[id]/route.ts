import { withMerchant } from "@/server/auth";
import { methodNotAllowed, ok, readJson } from "@/server/http";
import { deleteWebhook, updateWebhook } from "@/server/services";
import { parseUpdateWebhook } from "@/server/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Edit an endpoint: its URL, its events, or turn it on and off. */
export const PATCH = withMerchant<Ctx>(async (req, auth, { params }) => {
  const { id } = await params;
  const input = parseUpdateWebhook(await readJson(req));
  return ok(await updateWebhook(auth, id, input));
});

/** Remove an endpoint. Its delivery log stays. */
export const DELETE = withMerchant<Ctx>(async (_req, auth, { params }) => {
  const { id } = await params;
  return ok(await deleteWebhook(auth, id));
});

/* Everything else answers a JSON 405 naming what the route accepts. */
const notAllowed = methodNotAllowed(["PATCH", "DELETE"]);
export const GET = withMerchant(notAllowed);
export const POST = withMerchant(notAllowed);
export const PUT = withMerchant(notAllowed);
