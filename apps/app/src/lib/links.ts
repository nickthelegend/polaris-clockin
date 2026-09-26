/**
 * Turns whatever the buyer scanned or pasted into a path inside this app, or
 * null. Only Polaris destinations are accepted: a code can never send the
 * buyer to another site.
 *
 *   https://app.polarispay.app/pay/sol-brand   → /pay/sol-brand
 *   https://pay.polarispay.app/sol-brand       → /pay/sol-brand
 *   https://<this origin>/claim#k=…            → /claim#k=…
 *   https://<this origin>/send?to=…            → /send?to=…
 *   sol-brand                                  → /pay/sol-brand
 */
export function toAppPath(input: string, origin: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z0-9][a-z0-9-]{1,63}$/i.test(text)) return `/pay/${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const trusted =
    url.origin === origin || url.hostname === "polarispay.app" || url.hostname.endsWith(".polarispay.app");
  if (!trusted || (url.protocol !== "https:" && url.origin !== origin)) return null;

  if (url.hostname === "pay.polarispay.app") {
    const id = url.pathname.replace(/^\/+|\/+$/g, "");
    return /^[a-z0-9][a-z0-9-]{1,63}$/i.test(id) ? `/pay/${id}` : null;
  }
  const pay = url.pathname.match(/^\/pay\/([a-z0-9][a-z0-9-]{1,63})\/?$/i);
  if (pay) return `/pay/${pay[1]}`;
  if (url.pathname === "/claim" && url.hash.length > 1) return `/claim${url.hash}`;
  if (url.pathname === "/send" && url.search) return `/send${url.search}`;
  return null;
}
