import path from "node:path";
import type { NextConfig } from "next";

/**
 * Headers every page gets.
 *
 * - Checkout and claim run Face ID ceremonies, so the app refuses to be framed
 *   (WebKit also refuses passkey creation in cross-origin frames).
 * - `no-referrer`: claim links carry a key in the URL fragment. Browsers never
 *   put the fragment in a Referer, but nothing on these pages needs to leak
 *   the path either.
 * - Camera is for the QR scanner on /pay; passkeys only for this origin.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(self), microphone=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared component library ships TypeScript source.
  transpilePackages: ["@polaris/ui", "@polaris/brand"],
  // The workspace root, so a parent directory's lockfile is never mistaken for it.
  turbopack: { root: path.resolve(process.cwd(), "../..") },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
