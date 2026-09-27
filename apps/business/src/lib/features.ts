import type { Capabilities } from "./data/types";

/**
 * What can actually work right now, decided from what the server says it is
 * connected to (GET /api/health: the chain, the relayer, the payout signer).
 * A control whose service isn't connected is disabled with the reason beside
 * it: nothing is left to fail, and nothing claims money moved when it didn't.
 */

/** Our payout signer's key quorum, added to a merchant's wallet for automatic payouts. */
export const PAYOUT_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID || "";

/** The demo storefront (apps/shop, "Halcyon"), which pays through polarispay-sdk. */
export const DEMO_SHOP_URL = process.env.NEXT_PUBLIC_DEMO_SHOP_URL || "http://localhost:3600";

/** Where sample data on screen comes from, when it is on. */
export type SampleReason = "mock" | "server" | "preview" | null;

export type Readiness = {
  /** Null when one-tap withdraw works; otherwise why it doesn't, in words. */
  withdraw: string | null;
  /** Null when automatic payouts can be switched on. */
  autoPayouts: string | null;
  /** Null when buyers can open this merchant's links. */
  links: string | null;
  /** Null when the business can be registered on Monad. */
  registration: string | null;
};

const CHECKING = "Checking what this server is connected to…";
const UNCHECKED = "We couldn't check this server's connections. We'll try again in a moment.";

/**
 * Readiness for the dashboard's money controls. The development mock session
 * simulates everything in the browser (and labels it Sample); the preview
 * and a server with no chain refuse, with the reason.
 */
export function readiness(caps: Capabilities | null | undefined, sample: SampleReason, failed = false): Readiness {
  if (sample === "mock") return { withdraw: null, autoPayouts: null, links: null, registration: null };
  if (sample === "preview") {
    const reason = "This is the sample preview: there's no real balance behind it. Turn the preview off in your account menu to use your own.";
    return { withdraw: reason, autoPayouts: reason, links: null, registration: null };
  }
  if (!caps) {
    const why = failed ? UNCHECKED : CHECKING;
    return { withdraw: why, autoPayouts: why, links: why, registration: why };
  }

  const noChain = caps.chain
    ? null
    : "This server isn't connected to Monad yet, so your book is sample data and nothing can move.";
  const noRelayer = caps.relayer ? null : "Polaris's relayer isn't running on this server yet. It pays the network fee, so nothing can be sent until it is.";
  const noSigner =
    caps.automaticPayouts && PAYOUT_SIGNER_ID ? null : "Automatic payouts switch on once the Privy payout signer is set up on this server.";

  const noCheckout = caps.checkoutOrigin ? null : "Links go live once the checkout origin is configured on this server.";
  const noPublicUrl = caps.registrationUrl ? null : "Registration on Monad opens once this server's public URL is configured.";

  return {
    withdraw: noChain ?? noRelayer,
    autoPayouts: noChain ?? noRelayer ?? noSigner,
    links: noChain ? "Buyers can open links once this server is connected to Monad." : (noRelayer ?? noCheckout),
    registration: noChain ? "Registration on Monad opens once this server is connected to it." : (noRelayer ?? noPublicUrl),
  };
}
