import { type Address, isAddress, zeroAddress } from "viem";

/**
 * Public configuration. Every `process.env.NEXT_PUBLIC_*` read is written out
 * literally so Next inlines it at build time; nothing here is secret.
 */

function address(value: string | undefined, fallback: Address = zeroAddress): Address {
  return value && isAddress(value) ? value : fallback;
}

/** Agora's AUSD on Monad testnet (plan, Appendix A). */
const AUSD_TESTNET: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

export const env = {
  /** WebAuthn relying party id. Unset means the page's hostname. */
  rpId: process.env.NEXT_PUBLIC_RP_ID?.trim() || undefined,
  /** "1" swaps Face ID for a throwaway key in sessionStorage. Dev only. */
  devSigner: process.env.NEXT_PUBLIC_DEV_SIGNER === "1",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "10143"),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined,
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL?.trim() || "https://testnet.monadvision.com").replace(
    /\/+$/,
    "",
  ),
  /**
   * Polaris for Business, which runs the relayer (`/api/relay`) and serves
   * checkout sessions (`/api/public/sessions/{id}`), e.g. http://localhost:3100.
   * Unset: the relayer is a local stub and checkout links are sample data.
   */
  apiUrl: (process.env.NEXT_PUBLIC_POLARIS_API_URL?.trim() || "").replace(/\/+$/, "") || undefined,
  contracts: {
    ausd: address(process.env.NEXT_PUBLIC_AUSD_ADDRESS, AUSD_TESTNET),
    payments: address(process.env.NEXT_PUBLIC_PAYMENTS_ADDRESS),
    checkout: address(process.env.NEXT_PUBLIC_CHECKOUT_ADDRESS),
    send: address(process.env.NEXT_PUBLIC_SEND_ADDRESS),
    loanEngine: address(process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS),
  },
} as const;

export type ContractName = keyof typeof env.contracts;
