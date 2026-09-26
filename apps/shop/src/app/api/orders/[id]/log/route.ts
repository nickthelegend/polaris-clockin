import { appendSdkLog, getOrder } from "@/lib/orders/service";
import type { SdkCall } from "@/lib/orders/types";

export const dynamic = "force-dynamic";

const BROWSER_CALLS = new Set(["createPolaris", "polaris.openCheckout", "polaris.redirectToCheckout", "polaris.pay"]);

/**
 * The browser reports the SDK calls it made (openCheckout, pay) so the
 * "Built with Polaris" drawer shows both halves of the integration. This only
 * appends to a log; nothing here can touch an order's status.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getOrder(id))) return Response.json({ error: { message: "No such order." } }, { status: 404 });
  const text = await req.text();
  if (text.length > 16_000) return Response.json({ error: { message: "Too large." } }, { status: 413 });
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    return Response.json({ error: { message: "Not JSON." } }, { status: 400 });
  }
  if (!Array.isArray(entries) || entries.length > 10) {
    return Response.json({ error: { message: "Send up to 10 entries." } }, { status: 400 });
  }
  const clean: SdkCall[] = [];
  for (const raw of entries as Record<string, unknown>[]) {
    if (!raw || typeof raw.call !== "string" || !BROWSER_CALLS.has(raw.call)) continue;
    clean.push({
      at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
      side: "browser",
      call: raw.call,
      args: raw.args,
      result: raw.result,
      error: typeof raw.error === "string" ? raw.error.slice(0, 300) : undefined,
    });
  }
  await appendSdkLog(id, clean);
  return Response.json({ ok: true, recorded: clean.length });
}
