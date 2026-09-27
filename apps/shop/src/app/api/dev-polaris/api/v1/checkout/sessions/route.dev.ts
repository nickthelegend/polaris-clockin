import { devMockEnabled, devMockInternalOrigin, notFound } from "@/lib/dev-polaris/guard";
import { apiError, checkSecretKey, createSession } from "@/lib/dev-polaris/mock";

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
  // URLs on the fixed local origin, whatever Host the request carried: the
  // webhook goes back to this server, and the shop hands the browser its own
  // origin for the checkout page (see /api/checkout).
  const result = createSession(body, req.headers.get("idempotency-key"), devMockInternalOrigin());
  return Response.json(result.body, {
    status: result.status,
    headers: result.replayed ? { "idempotent-replayed": "true" } : undefined,
  });
}
