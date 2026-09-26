"use client";

// Every browser-side Polaris call the shop makes goes through this file.
// The imports that change when polarispay-sdk 0.3.0 is published:
//   import { createPolaris, MONAD_TESTNET } from "polarispay-sdk";
//   export { PolarisMessaging, ... } from "polarispay-sdk/react";
import { MONAD_TESTNET, createPolaris, type Polaris } from "./polaris-sdk/browser";

import type { BrowserPolarisConfig } from "./polaris-config";

export {
  PolarisCheckoutButton,
  PolarisLockup,
  PolarisMark,
  PolarisMessaging,
  PolarisPayButton,
  usePolarisCheckout,
} from "./polaris-sdk/react";
export type { PayButtonState } from "./polaris-sdk/react";
export type { CheckoutResult, CheckoutMode } from "./polaris-sdk/types";
export type { Polaris, PayResult } from "./polaris-sdk/browser";
export { isPolarisError, type PolarisError } from "./polaris-sdk/errors";
export { quotePayIn4 } from "./polaris-sdk/money";
export { MONAD_TESTNET } from "./polaris-sdk/browser";

/** The browser client for this store, or null when payments are off (or during SSR). */
export function makePolaris(config: BrowserPolarisConfig): Polaris | null {
  if (!config.ok || typeof window === "undefined") return null;
  const origin = window.location.origin;
  return createPolaris({
    publishableKey: config.publishableKey,
    checkoutOrigin: config.checkoutOrigin ?? origin,
    relayUrl: new URL(config.relayUrl, origin).toString(),
    // The dev mock can't read the token's EIP-712 domain from a chain, so it pins it.
    chain: config.target === "dev-mock" ? { ...MONAD_TESTNET, stablecoinDomain: { name: "AUSD", version: "1" } } : MONAD_TESTNET,
  });
}
