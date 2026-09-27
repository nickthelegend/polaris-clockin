import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where a webhook may be delivered: public HTTPS on port 443, nowhere else.
 *
 * A webhook URL is a request our server makes on a merchant's say-so, so an
 * unguarded one lets anyone make us call our own network (cloud metadata at
 * 169.254.169.254, a database on 10.x, the dev server on localhost). The check
 * runs twice: on the URL's shape when it is registered, and on the addresses
 * its hostname resolves to, at registration and again right before anything
 * is signed or sent for it (DNS can change after registration).
 *
 * `POLARIS_WEBHOOK_ALLOW_PRIVATE=1` lifts it for local testing, outside
 * production only.
 */

export function privateDestinationsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.POLARIS_WEBHOOK_ALLOW_PRIVATE === "1";
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function isPrivateIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private 172.16/12
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && p[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved, broadcast
  );
}

function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  // An embedded IPv4 tail (::ffff:10.0.0.1).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const p = ipv4Parts(v4[1]!);
    if (!p) return null;
    addr = addr.replace(v4[1]!, `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (addr.includes("::") ? h.length + t.length > 7 : h.length !== 8) return null;
  const fill = addr.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  const groups = [...h, ...fill, ...t].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroTo(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4 inside.
  const mapped = allZeroTo(5) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
    return isPrivateIPv4(v4);
  }
  return false;
}

/** True for loopback, private, link-local, CGNAT, unique-local, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

/**
 * What's wrong with a webhook URL's shape, or null. Synchronous: scheme,
 * port, credentials, and hostnames that are private on their face.
 */
export function webhookUrlProblem(url: URL): { message: string } | null {
  const relaxed = privateDestinationsAllowed();
  if (url.protocol !== "https:" && !(relaxed && url.protocol === "http:")) {
    return { message: "Webhook endpoints must use https://." };
  }
  if (url.username || url.password) return { message: "Put credentials in your receiver, not in the URL." };
  if (url.port && url.port !== "443" && !relaxed) {
    return { message: "Webhook endpoints must listen on the standard HTTPS port (443)." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!relaxed) {
    if (host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
      return { message: "That address is on a private network. Use your endpoint's public https:// URL." };
    }
    if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host)) {
      return { message: "That address is on a private network. Use your endpoint's public https:// URL." };
    }
    if (!host.includes(".") && !isIP(host.replace(/^\[|\]$/g, ""))) {
      return { message: "Use the endpoint's full public hostname, like hooks.yourshop.com." };
    }
  }
  return null;
}

/**
 * Resolve the hostname and refuse it if any address it points at is private.
 * Returns a problem to show, or null when every address is public.
 */
export async function resolveDestinationProblem(url: URL): Promise<{ message: string } | null> {
  const shape = webhookUrlProblem(url);
  if (shape) return shape;
  if (privateDestinationsAllowed()) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? { message: "That address is on a private network." } : null;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { message: "We couldn't find that hostname. Check the URL." };
  }
  if (addresses.length === 0) return { message: "We couldn't find that hostname. Check the URL." };
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return { message: "That hostname points to a private network address. Use a public endpoint." };
  }
  return null;
}
