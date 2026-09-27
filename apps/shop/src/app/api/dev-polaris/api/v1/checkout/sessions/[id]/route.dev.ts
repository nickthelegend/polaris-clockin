import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { apiError, checkSecretKey, getSession, publicSession } from "@/lib/dev-polaris/mock";

export const dynamic = "force-dynamic";

/** Dev mock of GET /api/v1/checkout/sessions/:id. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!devMockEnabled()) return notFound();
  const denied = checkSecretKey(req);
  if (denied) return denied;
  const { id } = await params;
  const session = getSession(id);
  if (!session) return apiError(404, "invalid_request_error", "resource_missing", `No checkout session ${id}.`, "id");
  return Response.json(publicSession(session));
}
