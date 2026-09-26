import "server-only";

import { getAddress } from "viem";

import type { Address } from "@/lib/data/types";
import { ausdDomain, DEFAULT_CHAIN } from "@/lib/chain";
import { getPrivy } from "./privy";

/**
 * The per-merchant Privy policy behind automatic daily payouts
 * (docs/research/privy.md §6.2).
 *
 * Our payout signer is added to the merchant's embedded wallet with this as its
 * override policy, so the only thing our server can ever get that wallet to
 * sign is an AUSD `TransferWithAuthorization` on Monad testnet, from the
 * merchant's own wallet, to the payout address they chose. Every other method
 * has no rule, and Privy denies unmatched requests.
 */

const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

// Byte-identical to what the sweep signs, EIP712Domain included: a typed-data
// condition only evaluates when the request's `types` map matches exactly.
const TWA_TYPES = {
  EIP712Domain: EIP712_DOMAIN,
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/** Addresses are compared as strings; accept both spellings. */
const both = (a: string) => [getAddress(a), a.toLowerCase()];

export function buildPayoutPolicy(merchantId: string, payoutAddress: Address, ausd: Address) {
  const message = (field: string, operator: "eq" | "in", value: string | string[]) => ({
    field_source: "ethereum_typed_data_message" as const,
    typed_data: { types: TWA_TYPES, primary_type: "TransferWithAuthorization" },
    field,
    operator,
    value,
  });

  return {
    version: "1.0" as const,
    // Names are capped at 50 characters.
    name: `payout-${merchantId.replace(/^did:privy:/, "")}`.slice(0, 50),
    chain_type: "ethereum" as const,
    rules: [
      {
        name: "AUSD to the payout address only",
        method: "eth_signTypedData_v4" as const,
        action: "ALLOW" as const,
        conditions: [
          {
            field_source: "ethereum_typed_data_domain" as const,
            field: "chainId" as const,
            operator: "eq" as const,
            value: String(DEFAULT_CHAIN.id),
          },
          {
            field_source: "ethereum_typed_data_domain" as const,
            field: "verifyingContract" as const,
            operator: "in" as const,
            value: both(ausd),
          },
          message("to", "in", both(payoutAddress)),
          message("from", "eq", "{{wallet.address}}"),
        ],
      },
    ],
  };
}

/**
 * Create the merchant's payout policy in Privy and return its ID, or null when
 * the payout signer isn't configured (the toggle is then recorded as sample
 * data and no signer is added).
 */
export async function createPayoutPolicy(merchantId: string, payoutAddress: Address): Promise<string | null> {
  const privy = getPrivy();
  const domain = ausdDomain();
  if (!privy || !domain || !process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID) return null;

  const body = buildPayoutPolicy(merchantId, payoutAddress, domain.verifyingContract);
  const adminQuorum = process.env.PRIVY_ADMIN_QUORUM_ID;
  const policy = await privy.policies().create({
    ...body,
    // With an owner, the app secret alone can't widen this policy later.
    ...(adminQuorum ? { owner_id: adminQuorum } : {}),
    idempotency_key: `payout-policy:${merchantId}:${payoutAddress.toLowerCase()}`,
  });
  return policy.id;
}
