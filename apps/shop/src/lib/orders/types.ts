import type { CheckoutMode, InstallmentStatus } from "@/lib/polaris-sdk/types";

/**
 * An order moves forward only: awaiting_payment → paid, or → needs_review
 * when Polaris reports a payment that doesn't match it. Nothing a browser
 * sends can move it; only a verified webhook does (see transitions.ts).
 */
export type OrderStatus = "awaiting_payment" | "paid" | "needs_review";

export type PaymentMethod = "polaris" | "wallet";

export interface OrderLine {
  productId: string;
  optionId: string;
  name: string;
  optionLabel: string;
  optionValue: string;
  image: string;
  /** Integer cents, per unit (per period for a subscription). */
  unitPrice: number;
  quantity: number;
  recurring?: "month";
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Contact {
  email: string;
  phone?: string;
}

export interface PlanInstallmentRecord {
  index: number;
  /** Cents. */
  amount: number;
  dueAt: string;
  status: InstallmentStatus;
  paidAt?: string | null;
}

export interface OrderPlan {
  planId: string;
  intervalSeconds: number;
  status: "active" | "past_due" | "completed" | "liquidated";
  installments: PlanInstallmentRecord[];
}

export interface OrderSubscription {
  subscriptionId: string;
  interval: "week" | "month";
  intervalCount: number;
  nextChargeAt: string;
  periodsCharged: number;
  status: "active" | "canceled";
  canceledAt?: string;
}

export interface ReceivedEvent {
  id: string;
  type: string;
  /** Unix seconds, from the event. */
  created: number;
  receivedAt: string;
  summary: string;
  outcome: "applied" | "flagged";
}

/** One SDK call, recorded for the "Built with Polaris" drawer. Never holds a key. */
export interface SdkCall {
  at: string;
  side: "server" | "browser";
  call: string;
  args?: unknown;
  result?: unknown;
  error?: string;
}

export interface Order {
  id: string;
  number: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  statusReason?: string;
  kind: "one_time" | "subscription";
  lines: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  contact: Contact;
  address: Address;
  payment: {
    method: PaymentMethod;
    /** What the buyer picked on the store's checkout; the hosted checkout may still change it. */
    requestedMode?: CheckoutMode;
    /** What Polaris reported: the mode actually paid in. */
    mode?: CheckoutMode | "direct";
    sessionId?: string;
    sessionUrl?: string;
    sessionExpiresAt?: string;
    sessionAttempt: number;
    paidAt?: string;
    payer?: string;
    txHash?: string;
    paymentId?: string;
  };
  plan?: OrderPlan;
  subscription?: OrderSubscription;
  events: ReceivedEvent[];
  sdkLog: SdkCall[];
}
