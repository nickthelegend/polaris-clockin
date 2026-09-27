import { centsToDecimal } from "@/lib/money";
import { parseCheckoutRequest } from "@/lib/orders/checkout-request";
import { appendSdkLog, attachSession, createOrder, nextSessionAttempt, reusableSession } from "@/lib/orders/service";
import type { Order, SdkCall } from "@/lib/orders/types";
import { requestOrigin } from "@/lib/origin";
import { createCheckoutSession, polarisConfig } from "@/lib/polaris";

export const dynamic = "force-dynamic";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:\-]{8,100}$/;

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

function summary(order: Order) {
  return { id: order.id, number: order.number, status: order.status, total: order.total };
}

/**
 * Place an order and start paying for it.
 *
 * - Polaris: create a checkout session with the SDK and return its URL, which
 *   the browser opens with openCheckout().
 * - Wallet: return the merchant, amount and order id the browser signs with
 *   pay().
 *
 * The order stays "awaiting_payment" until a verified webhook says otherwise.
 * Send an Idempotency-Key: a retried or double-clicked request gets the same
 * order and session back instead of a second one.
 */
export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const config = polarisConfig(origin);
  if (!config.ok) {
    return error(
      503,
      "payments_unavailable",
      "Payments are switched off on this store right now.",
      process.env.NODE_ENV === "development" ? { detail: config.reason } : {},
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, "invalid_json", "The request wasn't JSON.");
  }
  const parsed = parseCheckoutRequest(body);
  if (!parsed.ok) return error(422, "invalid_checkout", "Some details need another look.", { fields: parsed.errors });

  const key = req.headers.get("idempotency-key");
  if (key !== null && !IDEMPOTENCY_KEY.test(key)) {
    return error(400, "invalid_idempotency_key", "Idempotency-Key must be 8 to 100 letters, digits, _, - or :.");
  }

  const created = await createOrder(parsed.value, key);
  if (!created.ok) return error(409, "idempotency_conflict", "This checkout changed after it was sent. Please try again.");
  let order: Order = created.order;

  if (order.status !== "awaiting_payment" || order.payment.method === "wallet") {
    return Response.json({
      order: summary(order),
      reused: created.reused,
      ...(order.payment.method === "wallet" && order.status === "awaiting_payment"
        ? { wallet: { merchant: config.merchant, amount: centsToDecimal(order.total), orderId: order.id } }
        : {}),
    });
  }

  const open = reusableSession(order);
  if (open) {
    return Response.json({ order: summary(order), reused: true, checkout: { sessionId: open.id, url: open.url } });
  }

  if (order.payment.sessionId) order = (await nextSessionAttempt(order.id)) ?? order;
  try {
    const { session, log } = await createCheckoutSession(order, origin);
    // The dev mock lives on a fixed local origin; its test checkout page is
    // this same app, so the browser opens it on the origin it's already on.
    const url = config.target === "dev-mock" ? new URL(new URL(session.url).pathname, origin).href : session.url;
    await attachSession(order.id, { ...session, url }, log);
    return Response.json({ order: summary(order), reused: created.reused, checkout: { sessionId: session.id, url } });
  } catch (e) {
    const log = (e as { sdkLog?: SdkCall }).sdkLog;
    if (log) await appendSdkLog(order.id, [log]);
    console.error("[checkout] Couldn't create a Polaris session", e);
    return error(502, "polaris_unavailable", "We couldn't reach Polaris just now. Try again, or pay directly with a wallet.");
  }
}
