import { type Address, getAddress, type Hex } from "viem";
import { api } from "../api";
import type { PaymentLink } from "./types";

/**
 * Real checkout links, from Polaris for Business:
 *
 * - `cs_test_…`: a checkout session a merchant's server created with
 *   polarispay-sdk (`GET /api/public/sessions/{id}`);
 * - `pl_…`: a payment link from the dashboard. Opening one creates a fresh
 *   session with the link's terms (`POST /api/public/links/{id}/checkout`),
 *   once per page load; later reads refresh that session.
 *
 * Only public data: what the buyer needs to see and sign, never the
 * merchant's metadata or keys.
 */

type PublicSession = {
  id: string;
  status: "open" | "complete" | "expired";
  merchant: { id: string; name: string; address: Address };
  description: string;
  amountCents: number;
  modes: Array<"now" | "later" | "subscribe">;
  payIn4: {
    available: boolean;
    reason: string | null;
    installments: number;
    intervalSeconds: number;
    aprBps: number;
    principalUnits: string;
    totalUnits: string;
    schedule: Array<{ amountUnits: string }>;
  } | null;
  subscription: { planId: string | null; pricePerPeriodUnits: string; periodSeconds: number; periodsAuthorised: number } | null;
  chain: { chainId: number; merchant: Address; orderId: string; amountUnits: string };
  successUrl: string;
  cancelUrl: string | null;
  returnOrigin: string;
  expiresAt: string;
  payment: { mode: "now" | "later" | "subscribe"; txHash: Hex; paymentId: Hex | null; planId: string | null; subscriptionId: string | null } | null;
};

export function isRemoteLinkId(id: string): boolean {
  return /^cs_(test|live)_[A-Za-z0-9]{8,128}$/.test(id) || /^pl_[A-Za-z0-9]{8,64}$/.test(id);
}

export function toPaymentLink(s: PublicSession): PaymentLink {
  const principal = BigInt(s.chain.amountUnits);
  const later = s.payIn4?.available
    ? {
        installments: s.payIn4.installments,
        interval: s.payIn4.intervalSeconds,
        aprBps: s.payIn4.aprBps,
        amounts: s.payIn4.schedule.map((i) => BigInt(i.amountUnits)),
        total: BigInt(s.payIn4.totalUnits),
        interest: BigInt(s.payIn4.totalUnits) - principal,
      }
    : null;
  const subscription =
    s.subscription?.planId && s.modes.includes("subscribe")
      ? {
          planId: BigInt(s.subscription.planId),
          name: s.description,
          price: BigInt(s.subscription.pricePerPeriodUnits),
          periodSeconds: s.subscription.periodSeconds,
          periodsAuthorised: s.subscription.periodsAuthorised,
        }
      : null;
  return {
    id: s.id,
    merchant: { id: s.merchant.id, name: s.merchant.name, address: getAddress(s.chain.merchant), city: "", country: "", category: "" },
    description: s.description,
    amount: principal,
    orderId: s.chain.orderId,
    modes: { now: s.modes.includes("now"), later, subscription },
    successUrl: s.successUrl,
    status: s.status === "complete" ? "paid" : s.status,
    session: {
      returnOrigin: s.returnOrigin,
      cancelUrl: s.cancelUrl,
      expiresAt: Date.parse(s.expiresAt),
      payLaterUnavailable: s.modes.includes("later") && !s.payIn4?.available ? (s.payIn4?.reason ?? "Pay in 4 isn't available right now.") : null,
      preferredMode: s.modes[0] === "subscribe" ? "subscription" : (s.modes[0] ?? null),
      payment: s.payment,
    },
  };
}

/** Payment link id → the session opened for it on this page load. */
const opened = new Map<string, Promise<string>>();

export async function getRemotePaymentLink(id: string): Promise<PaymentLink | null> {
  let sessionId = id;
  if (id.startsWith("pl_")) {
    let pending = opened.get(id);
    if (!pending) {
      pending = api<PublicSession>(`/api/public/links/${encodeURIComponent(id)}/checkout`, { method: "POST", body: {} }).then((s) => s.id);
      pending.catch(() => opened.delete(id));
      opened.set(id, pending);
    }
    sessionId = await pending;
  }
  try {
    return toPaymentLink(await api<PublicSession>(`/api/public/sessions/${encodeURIComponent(sessionId)}`));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}
