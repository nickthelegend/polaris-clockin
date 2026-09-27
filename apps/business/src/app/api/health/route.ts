import { hasCronSecret, withPublic } from "@/server/auth";
import { getConfig, productionProblems } from "@/server/env";
import { ok, methodNotAllowed } from "@/server/http";
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
    ready: problems.length === 0,
    productionReady: problems.length === 0,
    ...(hasCronSecret(req) ? { problems } : {}),
  });
}, { limit: "health" });

/* Everything else answers a JSON 405 naming what the route accepts. */
const notAllowed = methodNotAllowed(["GET"]);
export const POST = withPublic(notAllowed, { limit: "health" });
export const PUT = withPublic(notAllowed, { limit: "health" });
export const PATCH = withPublic(notAllowed, { limit: "health" });
export const DELETE = withPublic(notAllowed, { limit: "health" });
