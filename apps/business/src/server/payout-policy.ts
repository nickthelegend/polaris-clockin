import "server-only";

import type { Address } from "viem";

import { getConfig } from "./env";
import { buildPayoutPolicy } from "./policy/payout";
import { getPrivy } from "./privy";

/**
 * Create the merchant's automatic-payout policy in Privy (research §6.2):
 * our payout signer may sign only an AUSD TransferWithAuthorization on this
 * chain, from the merchant's wallet, to `payoutAddress`, up to the per-payout
 * cap. The browser then adds the signer to the merchant's wallet with this
 * policy as its override (`useSigners().addSigners`), which only the merchant
 * can do.
 *
 * Returns null when the payout signer or the chain isn't configured; the
 * setting is then saved but no signer is added, and the UI says so.
 */
export async function createPayoutPolicy(merchantKey: string, payoutAddress: Address): Promise<string | null> {
  const config = getConfig();
  const privy = getPrivy();
  if (!privy || !config.chain || !config.payoutSigner) return null;

  const body = buildPayoutPolicy({
    merchantKey,
    payoutAddress,
    stablecoin: config.chain.contracts.stablecoin,
    chainId: config.chain.id,
  });
  const adminQuorum = process.env.PRIVY_ADMIN_QUORUM_ID;
  const policy = await privy.policies().create({
    ...(body as unknown as Parameters<ReturnType<typeof privy.policies>["create"]>[0]),
    // With an owner, the app secret alone can't widen this policy later (research §7).
    ...(adminQuorum ? { owner_id: adminQuorum } : {}),
    idempotency_key: `payout-policy:${merchantKey}:${payoutAddress.toLowerCase()}`,
  });
  return policy.id;
}
