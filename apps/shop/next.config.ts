import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import type { NextConfig } from "next";

/**
 * The dev mock of the Polaris API lives in files named `route.dev.ts` and
 * `page.dev.tsx` under src/app/api/dev-polaris. Next only treats a file as a
 * route when its extension is listed here, so those files are routes in
 * `next dev` and do not exist at all in `next build`: a production bundle
 * has no mock to reach, whatever the environment says. Each mock route also
 * refuses to answer outside NODE_ENV=development, and
 * scripts/assert-no-dev-mock.mjs fails the build if one ever slips in.
 *
 * HALCYON_DEV_MOCK is inlined into the bundle when it's built ("1" for `next
 * dev`, "0" for `next build`), so the shop's own switch to the mock (in
 * src/lib/polaris.ts) is decided at build time too, not by the NODE_ENV a
 * production server happens to start with.
 */
const PAGE_EXTENSIONS = ["tsx", "ts"];
const DEV_ONLY_EXTENSIONS = ["dev.tsx", "dev.ts"];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The store is never framed. It does open the Polaris checkout as a popup
  // and must keep a reference to it, so no Cross-Origin-Opener-Policy here.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    poweredByHeader: false,
    // No AGENTS.md / CLAUDE.md written into the app by `next dev`.
    agentRules: false,
    // The demo is recorded against `next dev`; keep Next's badge out of the shot
    // (it also sits where the "Built with Polaris" button does).
    devIndicators: false,
    env: { HALCYON_DEV_MOCK: dev ? "1" : "0" },
    pageExtensions: dev ? [...DEV_ONLY_EXTENSIONS, ...PAGE_EXTENSIONS] : PAGE_EXTENSIONS,
    // The workspace root, so a parent directory's lockfile is never mistaken for it.
    turbopack: { root: path.resolve(process.cwd(), "../..") },
    images: {
      formats: ["image/avif", "image/webp"],
      deviceSizes: [390, 640, 828, 1080, 1440, 1920],
    },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };
}
