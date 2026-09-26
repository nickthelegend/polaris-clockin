import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { apiError, checkSecretKey, createSession } from "@/lib/dev-polaris/mock";
import { requestOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/** Dev mock of POST /api/v1/checkout/sessions. */
export async function POST(req: Request) {
  if (!devMockEnabled()) return notFound();
  const denied = checkSecretKey(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_request_error", "invalid_json", "The body isn't JSON.");
  }
  const result = createSession(body, req.headers.get("idempotency-key"), requestOrigin(req));
  return Response.json(result.body, {
    status: result.status,
    headers: result.replayed ? { "idempotent-replayed": "true" } : undefined,
  });
}
