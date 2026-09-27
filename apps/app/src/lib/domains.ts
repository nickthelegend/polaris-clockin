import { type Address, zeroAddress } from "viem";
import { chain, publicClient } from "./chain";
import { type ContractName, env } from "./env";
import { getNetwork } from "./network";
import { RELAYER_IS_STUB } from "./relayer";
import { type Eip712Domain, placeholderDomain, readDomain } from "./sign";

/**
 * The EIP-712 domain for each verifying contract, read once per session.
 *
 * With Polaris for Business configured (`NEXT_PUBLIC_POLARIS_API_URL`), the
 * domains and addresses come from its deployment record (`network.ts`).
 * Otherwise they are read from the contract itself (ERC-5267), or, for an
 * unconfigured contract, a local placeholder that only the stub relayer
 * accepts.
 *
 * Pages call `prefetchDomains` on mount so the Face ID click handler never
 * waits on the network before the ceremony starts (WebKit wants the passkey
 * call to begin inside the user gesture).
 */

const PLACEHOLDER_NAMES: Record<ContractName, string> = {
  ausd: "AUSD (unconfigured)",
  payments: "PolarisPayments (unconfigured)",
  checkout: "PolarisCheckout (unconfigured)",
  send: "PolarisSend (unconfigured)",
  loanEngine: "PolarisLoanEngine (unconfigured)",
};

const cache = new Map<ContractName, Promise<Eip712Domain>>();

/** The address this build was configured with (zero when unset; see `resolveContract`). */
export function contractAddress(name: ContractName): Address {
  return env.contracts[name];
}

/** The contract's address: this build's, else the one Polaris reports. */
export async function resolveContract(name: ContractName): Promise<Address> {
  const network = getNetwork();
  if (network) return (await network).contracts[name];
  return env.contracts[name];
}

export function isConfigured(name: ContractName): boolean {
  return env.contracts[name] !== zeroAddress || getNetwork() !== null;
}

export function getDomain(name: ContractName): Promise<Eip712Domain> {
  let pending = cache.get(name);
  if (!pending) {
    const network = getNetwork();
    const address = contractAddress(name);
    pending = network
      ? network.then((n) => n.domains[name])
      : address === zeroAddress
        ? Promise.resolve(placeholderDomain(PLACEHOLDER_NAMES[name], chain.id, address))
        : readDomain(publicClient(), address).catch((error: unknown) => {
            if (RELAYER_IS_STUB) {
              // The stub relayer checks shapes, not domains; keep flows usable offline.
              console.warn(`Using a placeholder EIP-712 domain for ${name}:`, error);
              return placeholderDomain(PLACEHOLDER_NAMES[name], chain.id, address);
            }
            throw error;
          });
    // Don't cache a failure: the next attempt reads again.
    pending = pending.catch((error: unknown) => {
      cache.delete(name);
      throw error;
    });
    cache.set(name, pending);
  }
  return pending;
}

export function prefetchDomains(...names: ContractName[]): void {
  for (const name of names) void getDomain(name).catch(() => undefined);
}
