import "server-only";

import { centsToDecimal } from "@/lib/money";
import { payRefOf } from "@/lib/orders/access";
import type { Order, SdkCall } from "@/lib/orders/types";

import {
  createPolarisServer,
  type CheckoutSession,
  type CheckoutSessionCreateParams,
  type PolarisServer,
  type WebhookEvent,
} from "polarispay-sdk/server";

import { randomBytes } from "node:crypto";

import type { BrowserPolarisConfig, LocalChain } from "./polaris-config";

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
 *   POLARIS_RELAY_URL                    optional; defaults to {POLARIS_API_BASE}/api/v1/relay/payments
 *   NEXT_PUBLIC_POLARIS_PUBLISHABLE_KEY  pk_test_…
 *   NEXT_PUBLIC_POLARIS_CHECKOUT_ORIGIN  where hosted checkout pages live (the Polaris app)
 *
 * In `next dev` with POLARIS_API_BASE unset, the shop talks to its own dev
 * mock of the Polaris API under /api/dev-polaris instead. That can't happen
 * in production: whether the build may use the mock is decided when it is
 * built (HALCYON_DEV_MOCK, inlined by next.config.ts), the mock's routes
 * aren't compiled into a production build at all, and its secrets are random
 * per dev server process, never constants in the repository.
 */

/** Public by design (the relayer takes it); the mock's secret key and webhook secret are random, see devMockSecrets(). */
export const DEV_MOCK_PUBLISHABLE_KEY = "pk_test_devmock0001";
export const DEV_MOCK_MERCHANT: Address = "0x4a1c000000000000000000000000000000000000";
export const DEV_MOCK_PATH = "/api/dev-polaris";

type Env = Record<string, string | undefined>;

export interface DevMockSecrets {
  /** The only key the mock API accepts, and the only one the shop sends it. */
  secretKey: string;
  /** What the mock signs its webhooks with, and the only secret the shop verifies them with in mock mode. */
  webhookSecret: string;
}

/**
 * Fresh random secrets for this dev server process, shared by the shop and
 * its mock through globalThis (route handlers run in one process in `next
 * dev`). Nothing about them is in the repository, so knowing the source
 * doesn't let anyone sign a webhook the shop will accept. They change on
 * every restart, which the mock doesn't mind: it keeps no signed state.
 *
 * The check is written out here, not called, so that a production build,
 * where it reads `"0" !== "1"`, compiles the rest of the function away.
 */
export function devMockSecrets(): DevMockSecrets {
  if (process.env.HALCYON_DEV_MOCK !== "1") throw new Error("This build has no dev mock.");
  const holder = globalThis as unknown as { __halcyonDevMockSecrets?: DevMockSecrets };
  holder.__halcyonDevMockSecrets ??= {
    // Letters and digits after the prefix: the SDK refuses anything else in a key.
    secretKey: `sk_test_${randomBytes(16).toString("hex")}`,
    webhookSecret: `whsec_${randomBytes(24).toString("hex")}`,
  };
  return holder.__halcyonDevMockSecrets;
}

/**
 * Where the shop's server reaches its own mock: a fixed local origin, never
 * one taken from a request's Host or X-Forwarded-Host (which would let a
 * caller point the shop's bearer key at a server of their choosing).
 */
export function devMockInternalOrigin(env: Env = process.env): string {
  if (process.env.HALCYON_DEV_MOCK !== "1") throw new Error("This build has no dev mock.");
  const port = /^\d{2,5}$/.test(env.PORT ?? "") ? env.PORT : "3600";
  return `http://127.0.0.1:${port}`;
}

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
    // A literal "0" !== "1" in a production bundle, so this branch can't run there.
    if (process.env.HALCYON_DEV_MOCK !== "1" || env.NODE_ENV !== "development") {
      return { ok: false, reason: "POLARIS_API_BASE isn't set. Payments are off until it points at the Polaris API." };
    }
    // The shop's server reaches its mock on a fixed local origin, never one a request names.
    const mockBase = `${devMockInternalOrigin(env)}${DEV_MOCK_PATH}`;
    // Only the mock's own random secrets: a real POLARIS_SECRET_KEY is never sent to the mock.
    const secrets = devMockSecrets();
    return {
      ok: true,
      target: "dev-mock",
      baseUrl: mockBase,
      secretKey: secrets.secretKey,
      webhookSecret: secrets.webhookSecret,
      publishableKey: DEV_MOCK_PUBLISHABLE_KEY,
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
    // In production, success and cancel URLs come from SHOP_URL, never from a request's Host header.
    ...(env.NODE_ENV === "production" ? [["SHOP_URL", env.SHOP_URL] as const] : []),
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
    // The API's direct-pay relay route (apps/business: POST /api/v1/relay/payments).
    relayUrl: env.POLARIS_RELAY_URL?.trim() || `${baseUrl}/api/v1/relay/payments`,
    merchant: env.POLARIS_MERCHANT_ADDRESS!.trim() as Address,
  };
}

export function polarisConfig(origin: string): PolarisConfig {
  return resolvePolarisConfig(process.env, origin);
}

const ADDRESS_FIELDS = [
  "stablecoin",
  "payments",
  "loanEngine",
  "scoreManager",
  "collateralVault",
  "checkout",
  "send",
  "merchantRegistry",
  "collector",
  "batchSettlement",
] as const;

/**
 * `pnpm demo:local`'s chain, from POLARIS_LOCAL_CHAIN (a JSON object: chainId,
 * name, rpcUrl, explorer and each Polaris contract). Development only: the
 * NODE_ENV test folds to false in a production build, so a deployed store
 * always pays on Monad. Null when unset or malformed.
 */
export function localChain(env: Env = process.env): LocalChain | null {
  if (process.env.NODE_ENV !== "development") return null;
  const raw = env.POLARIS_LOCAL_CHAIN?.trim();
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Record<string, unknown>;
    if (!Number.isInteger(c.chainId) || typeof c.rpcUrl !== "string") return null;
    const zero = "0x0000000000000000000000000000000000000000";
    const addresses = Object.fromEntries(
      ADDRESS_FIELDS.map((k) => [k, typeof c[k] === "string" && ADDRESS.test(c[k] as string) ? c[k] : zero]),
    ) as Pick<LocalChain, (typeof ADDRESS_FIELDS)[number]>;
    return {
      chainId: c.chainId as number,
      name: typeof c.name === "string" ? c.name : "Local chain",
      rpcUrl: c.rpcUrl,
      explorer: typeof c.explorer === "string" ? c.explorer : "",
      ...addresses,
    };
  } catch {
    return null;
  }
}

/** What the browser may know: no secrets. Passed from server components as props. */
export function browserConfig(): BrowserPolarisConfig {
  // The origin only matters to the dev mock, whose URLs the browser resolves against its own.
  const config = resolvePolarisConfig(process.env, "");
  const payInFourAprBps = payInFourApr();
  if (!config.ok) return { ok: false, reason: config.reason, payInFourAprBps };
  // Written out so a production build folds it to false and drops the mock's paths.
  const mock = process.env.HALCYON_DEV_MOCK === "1" && config.target === "dev-mock";
  return {
    ok: true,
    target: config.target,
    publishableKey: config.publishableKey,
    checkoutOrigin: mock ? null : config.checkoutOrigin,
    relayUrl: mock ? `${DEV_MOCK_PATH}/api/v1/relay` : config.relayUrl,
    payInFourAprBps,
    chain: localChain(process.env),
  };
}

/**
 * Pay in 4 pricing shown on the store, in basis points of APR: always
 * PolarisLoanEngine.INTEREST_RATE_BPS (1000, 10% APR), what the buyer is
 * actually charged. The engine has no other rate, so the store never quotes
 * one (and never an interest-free plan): POLARIS_PAY_IN_4_APR_BPS is read only
 * to warn when it disagrees.
 */
export const LOAN_ENGINE_APR_BPS = 1000;

export function payInFourApr(env: Env = process.env): number {
  const raw = env.POLARIS_PAY_IN_4_APR_BPS?.trim();
  if (raw && Number(raw) !== LOAN_ENGINE_APR_BPS && !warnedApr) {
    warnedApr = true;
    console.warn(`POLARIS_PAY_IN_4_APR_BPS=${raw} is ignored: Polaris Pay in 4 is ${LOAN_ENGINE_APR_BPS / 100}% APR (PolarisLoanEngine).`);
  }
  return LOAN_ENGINE_APR_BPS;
}
let warnedApr = false;

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
    // The merchant's order number rides in the description, so Polaris (the dashboard, the Envio feed, the buyer's app) shows it.
    description: order.kind === "subscription" ? `Halcyon Coffee Club, monthly · ${order.number}` : `Halcyon order ${order.number}`,
    lineItems,
    // The first mode is the one the checkout opens on. Pay in 4 keeps Pay now
    // as a fallback, so a buyer whose plan isn't approved can still finish.
    modes: mode === "later" ? ["later", "now"] : [mode],
    ...(order.kind === "subscription" ? { subscription: { interval: "month" as const, intervalCount: 1 } } : {}),
    successUrl: `${origin}/orders/${order.id}?via=polaris`,
    // A subscription checks out on its own page, which the cancel URL has to name to come back to it.
    cancelUrl:
      order.kind === "subscription" && order.lines[0]
        ? `${origin}/checkout?subscribe=${order.lines[0].productId}&option=${order.lines[0].optionId}&canceled=1`
        : `${origin}/checkout?order=${order.id}&canceled=1`,
    // Echoed back as data.orderId on every webhook for this session. The
    // payRef, not the order id: Polaris may write it on chain.
    orderId: payRefOf(order),
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
