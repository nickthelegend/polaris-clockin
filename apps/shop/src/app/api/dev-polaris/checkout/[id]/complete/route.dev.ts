import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { completeSession, deliver } from "@/lib/dev-polaris/mock";

export const dynamic = "force-dynamic";

/** The test checkout's "Complete test payment": finish the session and send its webhooks. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!devMockEnabled()) return notFound();
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "later" || body.mode === "subscribe" || body.mode === "now" ? body.mode : null;
  if (!mode) return Response.json({ error: { message: "Choose a way to pay." } }, { status: 400 });
  const result = completeSession(id, mode);
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status });
  const deliveries = await deliver(result.events, result.session.webhookUrl, undefined, id);
  return Response.json({ status: "complete", mode, deliveries });
}
