import { hasCronSecret, withPublic } from "@/server/auth";
import { getConfig, productionProblems } from "@/server/env";
import { ok, methodNotAllowed } from "@/server/http";
import { privyServerConfig } from "@/server/privy";
import { getRelayerAccount } from "@/server/relayer/signer";

export const dynamic = "force-dynamic";

/**
 * What this server is wired to, without a single secret: the chain, the
 * relayer's mode and address, whether payouts and activation are set up.
 * The dashboard's setup screen and the end-to-end script read it.
 *
 * What production is still missing (`productionProblems`) names our own
 * weak spots ("POLARIS_KEY_PEPPER is not set"), so the list goes only to
 * the operator (`Authorization: Bearer <CRON_SECRET>`); everyone else sees
 * whether production is ready (the details are also logged at startup).
 */
export const GET = withPublic(async (req) => {
  const config = getConfig();
  const relayer = await getRelayerAccount().catch(() => null);
  const problems = productionProblems(config);
  return ok({
    ok: config.chain !== null && relayer !== null,
    chain: config.chain ? { id: config.chain.id, name: config.chain.name, contracts: config.chain.contracts } : null,
    chainProblem: config.chainProblem,
    relayer: { mode: config.relayer.mode, address: relayer?.address ?? null },
    activator: config.activator.mode,
    automaticPayouts: config.payoutSigner !== null,
    checkoutOrigin: config.checkoutOrigin,
    publicUrl: config.publicUrl,
    appOrigins: config.appOrigins,
    productionReady: problems.length === 0,
    build: buildFlags(config),
    ...(hasCronSecret(req) ? { problems } : {}),
  });
}, { limit: "health" });

/**
 * How this build and process are wired, for scripts/deploy-check.mjs; all of
 * it public. The mock session is decided when Next builds (next.config.ts
 * blanks POLARIS_DEV_MOCK_SESSION outside `next dev`), so a production build
 * always reports false; the local session is `pnpm demo:local`'s, which the
 * server refuses in production. `privyAppId` and `demoShopUrl` are what the
 * browser bundle was built with (NEXT_PUBLIC_*, inlined at build time), and
 * `privyServerAppId` the app the server verifies sign-ins against: the two
 * must be the same Privy app.
 */
function buildFlags(config: ReturnType<typeof getConfig>) {
  const privy = privyServerConfig();
  return {
    production: config.production,
    devMockSession: process.env.NODE_ENV === "development" && Boolean(process.env.POLARIS_DEV_MOCK_SESSION),
    localSession: config.localSession !== null,
    privy: privy.configured,
    privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || null,
    privyServerAppId: privy.appId || null,
    demoShopUrl: process.env.NEXT_PUBLIC_DEMO_SHOP_URL || null,
    workers: config.workers,
  };
}

/* Everything else answers a JSON 405 naming what the route accepts. */
const notAllowed = methodNotAllowed(["GET"]);
export const POST = withPublic(notAllowed, { limit: "health" });
export const PUT = withPublic(notAllowed, { limit: "health" });
export const PATCH = withPublic(notAllowed, { limit: "health" });
export const DELETE = withPublic(notAllowed, { limit: "health" });
