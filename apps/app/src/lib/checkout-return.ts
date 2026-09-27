import type { PaymentLink } from "./data/types";
import type { RelayReceipt } from "./relayer";

/**
 * How the hosted checkout reports back to the merchant page that opened it,
 * exactly as polarispay-sdk's `openCheckout` listens (packages/sdk README,
 * "Checkout ↔ page messages"):
 *
 *   { type: "polaris:checkout", version: 1, event: "ready" | "completed" | "canceled" | "expired",
 *     sessionId, mode?, orderId?, txHash?, paymentId?, planId?, subscriptionId? }
 *
 * posted to `window.opener` with the session's return origin (the origin of
 * its successUrl) as the target, never "*". Opened with `?display=popup`, the
 * checkout posts its result and closes; otherwise it goes to `successUrl`.
 * It must not be served with `Cross-Origin-Opener-Policy: same-origin`.
 *
 * The /pay/[id] screen calls `announceReady` on load and `finishCheckout`
 * after the receipt (or `cancelCheckout` on Cancel).
 */

export type CheckoutEvent = "ready" | "completed" | "canceled" | "expired";
type Mode = "now" | "later" | "subscription" | "subscribe";

export function checkoutMessage(
  event: CheckoutEvent,
  sessionId: string,
  details: { mode?: "now" | "later" | "subscribe"; orderId?: string; txHash?: string; paymentId?: string; planId?: string; subscriptionId?: string } = {},
) {
  return { type: "polaris:checkout" as const, version: 1 as const, event, sessionId, ...details };
}

export function isPopupCheckout(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("display") === "popup";
}

/** Post to the opener, if this is a real session with an opener. Returns whether it posted. */
function post(link: PaymentLink, message: ReturnType<typeof checkoutMessage>): boolean {
  if (typeof window === "undefined" || !link.session || !window.opener) return false;
  try {
    (window.opener as Window).postMessage(message, link.session.returnOrigin);
    return true;
  } catch {
    return false;
  }
}

export function announceReady(link: PaymentLink): void {
  post(link, checkoutMessage("ready", link.id));
}

/**
 * After a confirmed payment: tell the opener, then close the popup, or go to
 * the merchant's success page. Returns false when the buyer should stay on
 * our receipt (a sample link, or a checkout opened directly).
 */
export function finishCheckout(link: PaymentLink, mode: Mode, receipt: RelayReceipt): boolean {
  const posted = post(
    link,
    checkoutMessage("completed", link.id, {
      mode: mode === "subscription" ? "subscribe" : mode,
      orderId: link.orderId,
      txHash: receipt.txHash,
      paymentId: receipt.paymentId,
      planId: receipt.planId,
      subscriptionId: receipt.subscriptionId,
    }),
  );
  if (posted && isPopupCheckout()) {
    window.close();
    return true;
  }
  if (link.session && link.successUrl && !isPopupCheckout()) {
    window.location.assign(link.successUrl);
    return true;
  }
  return false;
}

export function cancelCheckout(link: PaymentLink): void {
  const posted = post(link, checkoutMessage("canceled", link.id));
  if (posted && isPopupCheckout()) window.close();
  else if (link.session?.cancelUrl) window.location.assign(link.session.cancelUrl);
}

export function expireCheckout(link: PaymentLink): void {
  post(link, checkoutMessage("expired", link.id));
}
