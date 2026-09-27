import { withPublic } from "@/server/auth";
import { getConfig, productionProblems } from "@/server/env";
import { ok } from "@/server/http";
import { getRelayerAccount } from "@/server/relayer/signer";

export const dynamic = "force-dynamic";

/**
 * What this server is wired to, without a single secret: the chain, the
 * relayer's mode and address, whether payouts and activation are set up.
 * The dashboard's setup screen and the end-to-end script read it.
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
    problems: productionProblems(config),
  });
});
