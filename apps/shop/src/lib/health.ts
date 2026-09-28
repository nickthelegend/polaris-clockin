import { orderStoreKind, type OrderStoreKind } from "./orders/store";
import { resolvePolarisConfig } from "./polaris";

/**
 * What GET /api/health reports: that the store is up and how it is wired to
 * Polaris, for scripts/deploy-check.mjs. Never a secret: the API and checkout
 * origins, the payout address (direct wallet payments pay it in the open),
 * whether the publishable key is a test or live one, and where orders are
 * kept. A value that isn't a URL is reported as null rather than echoed.
 */

export type ShopHealth = {
  ok: true;
  service: "halcyon-shop";
  production: boolean;
  /** The dev mock of the Polaris API (next dev only; a production build has none). */
  devMock: boolean;
  polaris:
    | {
        configured: true;
        target: "backend" | "dev-mock";
        apiBase: string | null;
        checkoutOrigin: string | null;
        relayUrl: string | null;
        merchant: string;
        publishableKeyMode: "test" | "live" | "unknown";
      }
    | { configured: false; reason: string };
  /** SHOP_URL: where success and cancel URLs point. */
  shopUrl: string | null;
  orderStore: { kind: OrderStoreKind; serverless: boolean };
};

function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function shopHealth(env: Record<string, string | undefined> = process.env, devMock = process.env.HALCYON_DEV_MOCK === "1"): ShopHealth {
  const config = resolvePolarisConfig(env, "");
  return {
    ok: true,
    service: "halcyon-shop",
    production: env.NODE_ENV === "production",
    devMock,
    polaris: config.ok
      ? {
          configured: true,
          target: config.target,
          apiBase: config.target === "backend" ? originOf(config.baseUrl) : null,
          checkoutOrigin: config.target === "backend" ? originOf(config.checkoutOrigin) : null,
          relayUrl: config.target === "backend" ? config.relayUrl : null,
          merchant: config.merchant,
          publishableKeyMode: config.publishableKey.startsWith("pk_test_") ? "test" : config.publishableKey.startsWith("pk_live_") ? "live" : "unknown",
        }
      : { configured: false, reason: config.reason },
    shopUrl: originOf(env.SHOP_URL),
    orderStore: { kind: orderStoreKind(env), serverless: env.VERCEL === "1" },
  };
}
