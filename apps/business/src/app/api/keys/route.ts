import { withMerchant } from "@/server/auth";
import { ok, readJson } from "@/server/http";
import { createApiKey, listApiKeys } from "@/server/services";
import { parseCreateApiKey } from "@/server/validate";

export const dynamic = "force-dynamic";

/** API keys. Secrets never appear here: only a hint like `sk_test_…a1b2`. */
export const GET = withMerchant(async (_req, auth) => ok(await listApiKeys(auth)));

/** Create a key pair. The response carries the secret key once; we keep only its hash. */
export const POST = withMerchant(async (req, auth) => {
  const input = parseCreateApiKey(await readJson(req));
  return ok(await createApiKey(auth, input), 201);
});
