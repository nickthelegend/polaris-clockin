/**
 * The public shapes of polarispay-sdk 0.3.0 that the shop relies on: checkout
 * sessions, webhook events and the hosted checkout's result. Amounts are
 * decimal strings ("349.00"), never floats.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** How the buyer pays in the hosted checkout. */
export type CheckoutMode = "now" | "later" | "subscribe";
export const CHECKOUT_MODES: readonly CheckoutMode[] = ["now", "later", "subscribe"];

export type Currency = "USD";

export interface LineItem {
  name: string;
  quantity: number;
  /** Price of one, as a decimal string: "349.00". */
  unitAmount: string;
  description?: string;
  /** Absolute URL of a product photo the hosted checkout may show. */
  imageUrl?: string;
  sku?: string;
}

/**
 * Proposed for 0.3.0 (see the shop README): how often a `subscribe` session
 * charges. Without it the checkout has to assume monthly.
 */
export interface SubscriptionTerms {
  interval: "week" | "month";
  intervalCount?: number;
}

export interface CheckoutSessionCreateParams {
  /** The total, as a decimal string. */
  amount: string;
  currency: Currency;
  description: string;
  lineItems?: LineItem[];
  /** The modes the buyer may choose from. The first is the one the checkout opens on. */
  modes: CheckoutMode[];
  successUrl: string;
  cancelUrl?: string;
  /** Echoed back on the session and on every event it causes. */
  metadata?: Record<string, string>;
  subscription?: SubscriptionTerms;
  customerEmail?: string;
}

export type CheckoutSessionStatus = "open" | "complete" | "expired" | "canceled";

export interface CheckoutSession {
  id: string;
  object: "checkout.session";
  /** Where the buyer pays: the hosted checkout, on the checkout origin. */
  url: string;
  status: CheckoutSessionStatus;
  /** ISO 8601. */
  expiresAt: string;
  createdAt?: string;
  amount?: string;
  currency?: Currency;
  description?: string;
  modes?: CheckoutMode[];
  lineItems?: LineItem[];
  metadata?: Record<string, string>;
  /** The mode the buyer chose, once the session is complete. */
  mode?: CheckoutMode | null;
  successUrl?: string;
  cancelUrl?: string | null;
  subscription?: SubscriptionTerms | null;
  livemode?: boolean;
}

export interface RequestOptions {
  /** Makes a retried create return the first result instead of a second session. */
  idempotencyKey?: string;
}

/* ── Webhook events ─────────────────────────────────────────────────────── */

export type PolarisEventType =
  | "payment.succeeded"
  | "plan.opened"
  | "installment.collected"
  | "installment.failed"
  | "plan.completed"
  | "plan.liquidated"
  | "subscription.charged"
  | "subscription.canceled"
  | "payout.paid";

export const POLARIS_EVENT_TYPES: readonly PolarisEventType[] = [
  "payment.succeeded",
  "plan.opened",
  "installment.collected",
  "installment.failed",
  "plan.completed",
  "plan.liquidated",
  "subscription.charged",
  "subscription.canceled",
  "payout.paid",
];

/** Fields every payment-related event carries so a merchant can find its order. */
export interface EventOrderRef {
  /** The on-chain order id, which is the merchant's metadata.orderId when a session set one. */
  orderId?: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

export interface PaymentSucceededData extends EventOrderRef {
  paymentId: string;
  amount: string;
  currency: Currency;
  mode: CheckoutMode | "direct";
  payer?: Address;
  txHash?: Hex;
}

export type InstallmentStatus = "paid" | "due" | "upcoming" | "failed";

export interface PlanInstallment {
  /** 1-based. */
  index: number;
  amount: string;
  /** ISO 8601. */
  dueAt: string;
  status: InstallmentStatus;
  paidAt?: string | null;
}

export interface PlanOpenedData extends EventOrderRef {
  planId: string;
  amount: string;
  currency: Currency;
  intervalSeconds: number;
  installments: PlanInstallment[];
}

export interface InstallmentEventData extends EventOrderRef {
  planId: string;
  index: number;
  amount: string;
  txHash?: Hex;
  /** installment.failed: why, in a sentence, and when Polaris retries. */
  reason?: string;
  nextAttemptAt?: string | null;
}

export interface PlanClosedData extends EventOrderRef {
  planId: string;
}

export interface SubscriptionChargedData extends EventOrderRef {
  subscriptionId: string;
  amount: string;
  currency: Currency;
  /** 1 for the charge at checkout. */
  period: number;
  interval: SubscriptionTerms["interval"];
  intervalCount: number;
  /** ISO 8601. */
  nextChargeAt: string;
  txHash?: Hex;
}

export interface SubscriptionCanceledData extends EventOrderRef {
  subscriptionId: string;
  canceledAt: string;
}

export interface PayoutPaidData {
  payoutId: string;
  amount: string;
  currency: Currency;
  destination: Address;
  txHash?: Hex;
}

export interface PolarisEventDataMap {
  "payment.succeeded": PaymentSucceededData;
  "plan.opened": PlanOpenedData;
  "installment.collected": InstallmentEventData;
  "installment.failed": InstallmentEventData;
  "plan.completed": PlanClosedData;
  "plan.liquidated": PlanClosedData;
  "subscription.charged": SubscriptionChargedData;
  "subscription.canceled": SubscriptionCanceledData;
  "payout.paid": PayoutPaidData;
}

export type PolarisEvent = {
  [K in PolarisEventType]: {
    id: string;
    object: "event";
    type: K;
    /** Unix seconds. */
    created: number;
    livemode: boolean;
    data: PolarisEventDataMap[K];
  };
}[PolarisEventType];

/* ── The hosted checkout's answer to the opener ─────────────────────────── */

/**
 * What the hosted checkout posts to `window.opener` (target origin: the
 * successUrl's origin) just before it closes the popup.
 */
export interface CheckoutMessage {
  source: "polaris-checkout";
  version: 1;
  sessionId: string;
  status: "complete" | "canceled";
  mode?: CheckoutMode | null;
  orderId?: string | null;
}

export type CheckoutResult =
  /** The buyer finished. Wait for the webhook before fulfilling: this came from a browser. */
  | { status: "complete"; sessionId: string; mode: CheckoutMode | null; orderId: string | null }
  /** The buyer pressed Cancel in the checkout. */
  | { status: "canceled"; sessionId: string }
  /** The buyer closed the popup without finishing. */
  | { status: "closed"; sessionId: string | null }
  /** The page is navigating to the checkout (mobile, or the popup was blocked). */
  | { status: "redirected"; sessionId: string | null };
