/**
 * Where a payment link points. The server gives every link its URL,
 * `${POLARIS_CHECKOUT_ORIGIN}/pay/${id}`, and the Polaris app opens a fresh
 * checkout session from it (POST /api/public/links/:id/checkout). This is
 * only for links the browser invents: the sample book and the mock session.
 */

const CHECKOUT_ORIGIN = (process.env.NEXT_PUBLIC_CONSUMER_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

export function linkUrl(id: string): string {
  return `${CHECKOUT_ORIGIN}/pay/${encodeURIComponent(id)}`;
}
