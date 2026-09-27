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
    }
  | { ok: false; reason: string; payInFourAprBps: number };
