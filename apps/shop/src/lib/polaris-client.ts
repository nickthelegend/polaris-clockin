"use client";

// Every browser-side Polaris call the shop makes goes through this file.
import { MONAD_TESTNET, createPolaris, type Polaris, type PolarisChain } from "polarispay-sdk";

import type { BrowserPolarisConfig } from "./polaris-config";

export { PolarisCheckoutButton, PolarisMark, PolarisMessaging } from "polarispay-sdk/react";
export { MONAD_TESTNET, isPolarisError, quotePayIn4 } from "polarispay-sdk";
export type { CheckoutMode, CheckoutResult, PayResult, PayStage, Polaris, PolarisError } from "polarispay-sdk";

/**
 * The dev mock's chain: Monad testnet, with a stand-in PolarisPayments at
 * 0x…dEaD, which no one can call from. A buyer's signature for it can never
 * move money; the mock relayer only checks it.
 */
export const DEV_MOCK_PAYMENTS = "0x000000000000000000000000000000000000dEaD" as const;
const DEV_MOCK_CHAIN: PolarisChain = { ...MONAD_TESTNET, payments: DEV_MOCK_PAYMENTS };

/** The chain direct wallet payments sign for: `pnpm demo:local`'s, the dev mock's stand-in, or Monad testnet. */
export function chainFor(config: BrowserPolarisConfig): PolarisChain {
  if (config.ok && config.chain) {
    return {
      ...MONAD_TESTNET,
      ...config.chain,
      key: "local",
      testnet: true,
      deployment: { source: "pnpm demo:local", deployedAt: null },
    };
  }
  return config.ok && config.target === "dev-mock" ? DEV_MOCK_CHAIN : MONAD_TESTNET;
}

/** The browser client for this store, or null when payments are off (or during SSR). */
export function makePolaris(config: BrowserPolarisConfig): Polaris | null {
  if (!config.ok || typeof window === "undefined") return null;
  const origin = window.location.origin;
  return createPolaris({
    publishableKey: config.publishableKey,
    checkoutOrigin: config.checkoutOrigin ?? origin,
    relayUrl: new URL(config.relayUrl, origin).toString(),
    chain: chainFor(config),
  });
}
