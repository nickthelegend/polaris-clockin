import { type Address, zeroAddress } from "viem";
import { chain, publicClient } from "./chain";
import { type ContractName, env } from "./env";
import { RELAYER_IS_STUB } from "./relayer";
import { type Eip712Domain, placeholderDomain, readDomain } from "./sign";

/**
 * The EIP-712 domain for each verifying contract, read once per session.
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

export function contractAddress(name: ContractName): Address {
  return env.contracts[name];
}

export function isConfigured(name: ContractName): boolean {
  return env.contracts[name] !== zeroAddress;
}

export function getDomain(name: ContractName): Promise<Eip712Domain> {
  let pending = cache.get(name);
  if (!pending) {
    const address = contractAddress(name);
    pending =
      address === zeroAddress
        ? Promise.resolve(placeholderDomain(PLACEHOLDER_NAMES[name], chain.id, address))
        : readDomain(publicClient(), address).catch((error: unknown) => {
            // Don't cache a failure: the next attempt reads again.
            cache.delete(name);
            if (RELAYER_IS_STUB) {
              // The stub relayer checks shapes, not domains; keep flows usable offline.
              console.warn(`Using a placeholder EIP-712 domain for ${name}:`, error);
              return placeholderDomain(PLACEHOLDER_NAMES[name], chain.id, address);
            }
            throw error;
          });
    cache.set(name, pending);
  }
  return pending;
}

export function prefetchDomains(...names: ContractName[]): void {
  for (const name of names) void getDomain(name).catch(() => undefined);
}
