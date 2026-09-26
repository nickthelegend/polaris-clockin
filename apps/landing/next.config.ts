import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The mark and logotype come from the workspace brand package.
  transpilePackages: ["@polaris/brand"],
  // Don't write AGENTS.md / CLAUDE.md into the app on `next dev`.
  agentRules: false,
  images: {
    // Assets in public/assets are dropped in by hand at any size, so they are
    // served as they are.
    unoptimized: true,
  },
};

export default nextConfig;
