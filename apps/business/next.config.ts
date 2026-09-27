import type { NextConfig } from "next";

const development = process.env.NODE_ENV === "development";

/** The dashboard moved under /dashboard; old deep links keep working. */
const MOVED = ["payments", "links", "plans", "payouts", "developers"];

const config: NextConfig = {
  reactStrictMode: true,
  // No floating dev badge over the sidebar (it only exists in `next dev`).
  devIndicators: false,
  poweredByHeader: false,
  // The component library, the brand and @polaris/db ship TypeScript source.
  transpilePackages: ["@polaris/ui", "@polaris/brand", "@polaris/db"],
  // The Privy Node SDK verifies tokens with `jose` and signs wallet requests with
  // node:crypto. Keep it out of the server bundle so it loads as plain Node.
  serverExternalPackages: ["@privy-io/node"],
  env: {
    // The screenshot-only mock session exists in `next dev` alone. Outside
    // development the variable is blanked here, and the code checks NODE_ENV
    // too (see src/lib/auth-context.tsx), so a production build can't turn it on.
    POLARIS_DEV_MOCK_SESSION: development ? (process.env.POLARIS_DEV_MOCK_SESSION ?? "") : "",
    // `pnpm demo:local`'s signed-in dashboard on a local chain; never in a production build.
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION: development ? (process.env.NEXT_PUBLIC_POLARIS_LOCAL_SESSION ?? "") : "",
    NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET: development ? (process.env.NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET ?? "") : "",
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return MOVED.flatMap((path) => [
      { source: `/${path}`, destination: `/dashboard/${path}`, permanent: false },
      { source: `/${path}/:rest*`, destination: `/dashboard/${path}/:rest*`, permanent: false },
    ]);
  },
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
