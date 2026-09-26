import { headers } from "next/headers";

/**
 * The store's public origin, for success URLs and absolute image URLs.
 * SHOP_URL pins it in a deployment; otherwise it comes from the request.
 */
export function requestOrigin(req: Request): string {
  const pinned = process.env.SHOP_URL?.trim();
  if (pinned) return new URL(pinned).origin;
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`;
  return new URL(req.url).origin;
}

/** The same, from a server component. */
export async function pageOrigin(): Promise<string> {
  const pinned = process.env.SHOP_URL?.trim();
  if (pinned) return new URL(pinned).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3600";
  const local = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
