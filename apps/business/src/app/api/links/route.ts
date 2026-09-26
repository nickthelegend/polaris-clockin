import { withMerchant } from "@/server/auth";
import { ok, readJson } from "@/server/http";
import { createLink, listLinks } from "@/server/services";
import { parseCreateLink } from "@/server/validate";

export const dynamic = "force-dynamic";

/** The merchant's payment links, newest first. */
export const GET = withMerchant(async (_req, auth) => ok(await listLinks(auth)));

/** Create a link: amount, description, modes, single-use or reusable, expiry. */
export const POST = withMerchant(async (req, auth) => {
  const input = parseCreateLink(await readJson(req));
  return ok(await createLink(auth, input), 201);
});
