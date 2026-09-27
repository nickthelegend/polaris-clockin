import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared component library ships TypeScript source.
  transpilePackages: ["@polaris/ui", "@polaris/brand"],
  // The Privy Node SDK verifies tokens with `jose` and signs wallet requests with
  // node:crypto. Keep it out of the server bundle so it loads as plain Node.
  serverExternalPackages: ["@privy-io/node"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Nothing an API route returns is safe to cache: it is all per merchant.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default config;
