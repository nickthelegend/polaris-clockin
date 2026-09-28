import { devMockEnabled, notFound } from "@/lib/dev-polaris/guard";
import { cancelSession } from "@/lib/dev-polaris/mock";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!devMockEnabled()) return notFound();
  const { id } = await params;
  const session = cancelSession(id);
  if (!session) return Response.json({ error: { message: "No such session." } }, { status: 404 });
  return Response.json({ status: session.status });
}
