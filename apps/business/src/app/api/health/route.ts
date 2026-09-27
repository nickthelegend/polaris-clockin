import { withPublic } from "@/server/auth";
import { getConfig, productionProblems } from "@/server/env";
import { ok, methodNotAllowed } from "@/server/http";
import { getRelayerAccount } from "@/server/relayer/signer";

export const dynamic = "force-dynamic";

/**
 * What this server is wired to, without a single secret: the chain, the
 * relayer's mode and address, whether payouts and activation are set up.
 * The dashboard's setup screen and the end-to-end script read it. What is
 * misconfigured stays private: only whether production is ready (the
 * details are logged at startup by the workers).
 */
export const GET = withPublic(async () => {
  const config = getConfig();
  const relayer = await getRelayerAccount().catch(() => null);
  return ok({
    ok: config.chain !== null && relayer !== null,
    chain: config.chain ? { id: config.chain.id, name: config.chain.name, contracts: config.chain.contracts } : null,
    chainProblem: config.chainProblem,
    relayer: { mode: config.relayer.mode, address: relayer?.address ?? null },
    activator: config.activator.mode,
    automaticPayouts: config.payoutSigner !== null,
    checkoutOrigin: config.checkoutOrigin,
    publicUrl: config.publicUrl,
    ready: productionProblems(config).length === 0,
  });
}, { limit: "health" });

/* Everything else answers a JSON 405 naming what the route accepts. */
const notAllowed = methodNotAllowed(["GET"]);
export const POST = withPublic(notAllowed, { limit: "health" });
export const PUT = withPublic(notAllowed, { limit: "health" });
export const PATCH = withPublic(notAllowed, { limit: "health" });
export const DELETE = withPublic(notAllowed, { limit: "health" });
