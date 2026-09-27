/**
 * Where a payment link points, and whether it can be opened yet.
 *
 * A link is `<consumer app>/pay/<id>`: the buyer pays in the Polaris app.
 * Until the consumer checkout reads links from the store the dashboard writes
 * to (today it reads its own mock data), a link created here can't be opened
 * or paid, so the dashboard disables "Open checkout", copy and QR and says so.
 * Set NEXT_PUBLIC_PAY_LINKS_LIVE=1 once it can.
 */

const CONSUMER_APP_URL = (process.env.NEXT_PUBLIC_CONSUMER_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

export const PAY_BASE_URL = (process.env.NEXT_PUBLIC_PAY_BASE_URL || `${CONSUMER_APP_URL}/pay`).replace(/\/+$/, "");

/** True once a link created here resolves to a working checkout. */
export const PAY_LINKS_LIVE = process.env.NEXT_PUBLIC_PAY_LINKS_LIVE === "1";

export const PAY_LINKS_PENDING_REASON =
  "Checkout goes live when the Polaris app reads links from this dashboard. Until then you can create links here, but sharing, copying and QR codes stay off.";

export function linkUrl(id: string): string {
  return `${PAY_BASE_URL}/${encodeURIComponent(id)}`;
}
