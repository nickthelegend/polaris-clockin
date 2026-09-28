/** A local chain's name, RPC and Polaris contracts (from its deployment record). */
export type LocalChain = {
  chainId: number;
  name: string;
  rpcUrl: string;
  /** "" when there is no explorer (a Hardhat node). */
  explorer: string;
  stablecoin: `0x${string}`;
  payments: `0x${string}`;
  loanEngine: `0x${string}`;
  scoreManager: `0x${string}`;
  collateralVault: `0x${string}`;
  checkout: `0x${string}`;
  send: `0x${string}`;
  merchantRegistry: `0x${string}`;
  collector: `0x${string}`;
  batchSettlement: `0x${string}`;
};

/**
 * The Polaris settings a browser may see, handed from server components to
 * client ones. No secrets: the publishable key is public by design.
 */
export type BrowserPolarisConfig =
  | {
      ok: true;
      target: "backend" | "dev-mock";
      publishableKey: string;
      /** null: the hosted checkout is on this store's own origin (the dev mock). */
      checkoutOrigin: string | null;
      /** May be relative to the store's origin. */
      relayUrl: string;
      payInFourAprBps: number;
      /**
       * `pnpm demo:local`'s chain (development only): the contracts a direct
       * wallet payment signs for. Null: Monad testnet, from polarispay-sdk.
       */
      chain?: LocalChain | null;
    }
  | { ok: false; reason: string; payInFourAprBps: number };
