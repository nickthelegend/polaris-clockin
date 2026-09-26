import "server-only";

import { centsToDecimal } from "@/lib/money";
import type { Order, SdkCall } from "@/lib/orders/types";

import {
  createPolarisServer,
  type CheckoutSession,
  type CheckoutSessionCreateParams,
  type PolarisServer,
  type WebhookEvent,
} from "polarispay-sdk/server";

import type { BrowserPolarisConfig } from "./polaris-config";

export { PolarisError, PolarisSignatureVerificationError, isPolarisError } from "polarispay-sdk/server";
export type { CheckoutSession, WebhookEvent as PolarisEvent } from "polarispay-sdk/server";
// Pay in 4 pricing for server-rendered messaging: the loan engine's own maths.
export { quotePayIn4 } from "polarispay-sdk";

type Address = `0x${string}`;

/**
 * Every server-side Polaris call the shop makes goes through this file.
 *
 * Configuration, from the environment:
 *   POLARIS_API_BASE                     the Polaris API (e.g. http://localhost:3100)
 *   POLARIS_SECRET_KEY                   sk_test_… from Polaris for Business
 *   POLARIS_WEBHOOK_SECRET               whsec_… for /api/webhooks/polaris
 *   POLARIS_MERCHANT_ADDRESS             the store's payout address, for direct wallet payments
 *   POLARIS_RELAY_URL                    optional; defaults to {POLARIS_API_BASE}/api/v1/relay
 *   NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY  pk_test_…
 *   NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN  where hosted checkout pages live (the Polaris app)
 *
 * In `next dev` with POLARIS_API_BASE unset, the shop talks to its own dev
 * mock of the Polaris API under /api/dev-polaris instead. That can't happen
 * in production: NODE_ENV must be "development", and the mock's routes aren't
 * compiled into a production build at all (see next.config.ts).
 */

// Keys are letters and digits after the prefix: the SDK refuses anything else.
export const DEV_MOCK_SECRET_KEY = "sk_test_halcyonDevMock0001";
export const DEV_MOCK_PUBLISHABLE_KEY = "pk_test_halcyonDevMock0001";
export const DEV_MOCK_WEBHOOK_SECRET = "whsec_halcyon_dev_mock";
export const DEV_MOCK_MERCHANT: Address = "0x4a1c000000000000000000000000000000000000";
export const DEV_MOCK_PATH = "/api/dev-polaris";

type Env = Record<string, string | undefined>;

export type PolarisConfig =
  | {
      ok: true;
      /** "backend": a real Polaris API. "dev-mock": this app's own mock, development only. */
      target: "backend" | "dev-mock";
      baseUrl: string;
      secretKey: string;
      webhookSecret: string;
      publishableKey: string;
      checkoutOrigin: string;
      relayUrl: string;
      merchant: Address;
    }
  | { ok: false; reason: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function resolvePolarisConfig(env: Env, origin: string): PolarisConfig {
  const apiBase = env.POLARIS_API_BASE?.trim();
  if (!apiBase) {
    if (env.NODE_ENV !== "development") {
      return { ok: false, reason: "POLARIS_API_BASE isn't set. Payments are off until it points at the Polaris API." };
    }
    const mockBase = `${origin}${DEV_MOCK_PATH}`;
    return {
      ok: true,
      target: "dev-mock",
      baseUrl: mockBase,
      secretKey: env.POLARIS_SECRET_KEY?.trim() || DEV_MOCK_SECRET_KEY,
      webhookSecret: env.POLARIS_WEBHOOK_SECRET?.trim() || DEV_MOCK_WEBHOOK_SECRET,
      publishableKey: env.NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY?.trim() || DEV_MOCK_PUBLISHABLE_KEY,
      // The mock serves its test checkout from this app, so that is the origin messages come from.
      checkoutOrigin: origin,
      relayUrl: `${mockBase}/api/v1/relay`,
      merchant: ADDRESS.test(env.POLARIS_MERCHANT_ADDRESS ?? "") ? (env.POLARIS_MERCHANT_ADDRESS as Address) : DEV_MOCK_MERCHANT,
    };
  }

  const missing = [
    ["POLARIS_SECRET_KEY", env.POLARIS_SECRET_KEY],
    ["POLARIS_WEBHOOK_SECRET", env.POLARIS_WEBHOOK_SECRET],
    ["NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY", env.NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY],
    ["NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN", env.NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN],
    ["POLARIS_MERCHANT_ADDRESS", env.POLARIS_MERCHANT_ADDRESS],
  ].filter(([, value]) => !value?.trim());
  if (missing.length > 0) {
    return { ok: false, reason: `Set ${missing.map(([name]) => name).join(", ")} to take payments through Polaris.` };
  }
  if (!ADDRESS.test(env.POLARIS_MERCHANT_ADDRESS!.trim())) {
    return { ok: false, reason: "POLARIS_MERCHANT_ADDRESS must be a 0x-prefixed address." };
  }
  const baseUrl = apiBase.replace(/\/+$/, "");
  return {
    ok: true,
    target: "backend",
    baseUrl,
    secretKey: env.POLARIS_SECRET_KEY!.trim(),
    webhookSecret: env.POLARIS_WEBHOOK_SECRET!.trim(),
    publishableKey: env.NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY!.trim(),
    checkoutOrigin: new URL(env.NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN!.trim()).origin,
    relayUrl: env.POLARIS_RELAY_URL?.trim() || `${baseUrl}/api/v1/relay`,
    merchant: env.POLARIS_MERCHANT_ADDRESS!.trim() as Address,
  };
}

export function polarisConfig(origin: string): PolarisConfig {
  return resolvePolarisConfig(process.env, origin);
}

/** What the browser may know: no secrets. Passed from server components as props. */
export function browserConfig(): BrowserPolarisConfig {
  // The origin only matters to the dev mock, whose URLs the browser resolves against its own.
  const config = resolvePolarisConfig(process.env, "");
  const payInFourAprBps = payInFourApr();
  if (!config.ok) return { ok: false, reason: config.reason, payInFourAprBps };
  const mock = config.target === "dev-mock";
  return {
    ok: true,
    target: config.target,
    publishableKey: config.publishableKey,
    checkoutOrigin: mock ? null : config.checkoutOrigin,
    relayUrl: mock ? `${DEV_MOCK_PATH}/api/v1/relay` : config.relayUrl,
    payInFourAprBps,
  };
}

/** Pay in 4 pricing shown on the store. 0 is interest-free (merchant-funded); the loan engine's own rate is 1000 (10% APR). */
export function payInFourApr(env: Env = process.env): number {
  const value = Number(env.POLARIS_PAY_IN_4_APR_BPS ?? "0");
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
}

let cached: { key: string; server: PolarisServer } | null = null;

function server(config: Extract<PolarisConfig, { ok: true }>): PolarisServer {
  const key = `${config.baseUrl}|${config.secretKey}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      server: createPolarisServer({
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        // Looked up per request, so tests and instrumentation can patch fetch after the client exists.
        fetch: (input, init) => globalThis.fetch(input, init),
      }),
    };
  }
  return cached.server;
}

/** The checkout session parameters for an order: exactly what gets sent, and what the drawer shows. */
export function sessionParamsFor(order: Order, origin: string): CheckoutSessionCreateParams {
  const mode = order.payment.requestedMode ?? "now";
  const lineItems: NonNullable<CheckoutSessionCreateParams["lineItems"]> = order.lines.map((line) => ({
    name: `${line.name}, ${line.optionValue}`,
    quantity: line.quantity,
    unitAmount: centsToDecimal(line.unitPrice),
  }));
  if (order.shipping > 0) lineItems.push({ name: "Delivery", quantity: 1, unitAmount: centsToDecimal(order.shipping) });
  return {
    amount: centsToDecimal(order.total),
    currency: "USD",
    description: order.kind === "subscription" ? "Halcyon Coffee Club, monthly" : `Halcyon order ${order.number}`,
    lineItems,
    // The first mode is the one the checkout opens on. Pay in 4 keeps Pay now
    // as a fallback, so a buyer whose plan isn't approved can still finish.
    modes: mode === "later" ? ["later", "now"] : [mode],
    ...(order.kind === "subscription" ? { subscription: { interval: "month" as const, intervalCount: 1 } } : {}),
    successUrl: `${origin}/orders/${order.id}?via=polaris`,
    cancelUrl: `${origin}/checkout?order=${order.id}&canceled=1`,
    // Echoed back as data.orderId on every webhook for this session.
    orderId: order.id,
    metadata: { orderNumber: order.number },
  };
}

export async function createCheckoutSession(
  order: Order,
  origin: string,
): Promise<{ session: CheckoutSession; log: SdkCall }> {
  const config = polarisConfig(origin);
  if (!config.ok) throw new Error(config.reason);
  const params = sessionParamsFor(order, origin);
  const idempotencyKey = `${order.id}:session:${order.payment.sessionAttempt}`;
  const at = new Date().toISOString();
  try {
    const session = await server(config).checkout.sessions.create(params, { idempotencyKey });
    return {
      session,
      log: {
        at,
        side: "server",
        call: "polaris.checkout.sessions.create",
        args: [params, { idempotencyKey }],
        result: { id: session.id, url: session.url, status: session.status, expiresAt: session.expiresAt },
      },
    };
  } catch (error) {
    (error as { sdkLog?: SdkCall }).sdkLog = {
      at,
      side: "server",
      call: "polaris.checkout.sessions.create",
      args: [params, { idempotencyKey }],
      error: (error as Error).message,
    };
    throw error;
  }
}

export async function retrieveCheckoutSession(id: string, origin: string): Promise<{ session: CheckoutSession; log: SdkCall }> {
  const config = polarisConfig(origin);
  if (!config.ok) throw new Error(config.reason);
  const session = await server(config).checkout.sessions.retrieve(id);
  return {
    session,
    log: {
      at: new Date().toISOString(),
      side: "server",
      call: "polaris.checkout.sessions.retrieve",
      args: [id],
      result: { id: session.id, status: session.status, paymentStatus: session.paymentStatus, payment: session.payment },
    },
  };
}

/** Verify a delivery against the raw body. Throws PolarisSignatureVerificationError. */
export function verifyWebhook(rawBody: string, signature: string | null, origin: string, now?: number): WebhookEvent {
  const config = polarisConfig(origin);
  if (!config.ok) throw new Error(config.reason);
  return server(config).webhooks.verify(rawBody, signature, config.webhookSecret, now === undefined ? undefined : { now });
}

export function merchantAddress(origin: string): Address | null {
  const config = polarisConfig(origin);
  return config.ok ? config.merchant : null;
}
