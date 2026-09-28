import { cache } from "react";
import { type Address, getAddress, type Hex } from "viem";
import { api } from "../api";
import type { PaymentLink } from "./types";

/**
 * Real checkout links, from Polaris for Business:
 *
 * - `cs_test_…`: a checkout session a merchant's server created with
 *   polarispay-sdk (`GET /api/public/sessions/{id}`);
 * - `pl_…`: a payment link from the dashboard. Opening one creates a fresh
 *   session with the link's terms (`POST /api/public/links/{id}/checkout`):
 *   one per request on the server (the page and its metadata share it), one
 *   per page load in the browser. Never one shared between visitors: a
 *   reusable link paid by one person stays open for the next.
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

const openSession = (id: string) =>
  api<PublicSession>(`/api/public/links/${encodeURIComponent(id)}/checkout`, { method: "POST", body: {} }).then((s) => s.id);

/** Server: one session per link per request (React's request cache), so generateMetadata and the page share it. */
const openForRequest = cache(openSession);

/** Browser only: payment link id → the session opened for it on this page load. */
const opened = typeof window === "undefined" ? null : new Map<string, Promise<string>>();

function sessionFor(id: string, fresh: boolean): Promise<string> {
  if (!opened) return openForRequest(id);
  let pending = fresh ? undefined : opened.get(id);
  if (!pending) {
    pending = openSession(id);
    pending.catch(() => opened.delete(id));
    opened.set(id, pending);
  }
  return pending;
}

/** No such link or session, or one that is used up, turned off or expired: the page says the link goes nowhere. */
const gone = (error: unknown) => [404, 410].includes((error as { status?: number }).status ?? 0);

async function readSession(sessionId: string): Promise<PaymentLink | null> {
  try {
    return toPaymentLink(await api<PublicSession>(`/api/public/sessions/${encodeURIComponent(sessionId)}`));
  } catch (error) {
    if (gone(error)) return null;
    throw error;
  }
}

async function openLinkSession(id: string, fresh: boolean): Promise<PaymentLink | null> {
  try {
    return await readSession(await sessionFor(id, fresh));
  } catch (error) {
    if (gone(error)) return null;
    throw error;
  }
}

export async function getRemotePaymentLink(id: string): Promise<PaymentLink | null> {
  if (!id.startsWith("pl_")) return readSession(id);
  const link = await openLinkSession(id, false);
  // A reusable link whose session someone already paid opens a new one for this buyer.
  if (link && link.status !== "open" && opened) return openLinkSession(id, true);
  return link;
}
