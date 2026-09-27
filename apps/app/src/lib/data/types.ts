import type { Address, Hex } from "viem";
import type { Micros } from "../money";

/** Countries we draw a flag for. Anything else shows no badge. */
export type CountryCode = "AR" | "BR" | "DE" | "GB" | "IN" | "KE" | "MX" | "NG" | "PH" | "US";

export type Merchant = {
  id: string;
  name: string;
  /** Where the money lands. Never shown to the buyer. */
  address: Address;
  city: string;
  /** ISO 3166 alpha-2. */
  country: string;
  /** Short line under the name, e.g. "Design studio". */
  category: string;
};

export type Person = {
  id: string;
  name: string;
  country: CountryCode;
  /** How the sender recognises them: a phone number or handle. */
  handle: string;
  address?: Address;
};

export type Profile = { name: string; memberSince: number };

export type Balance = {
  /** Spendable dollars, base units (6 decimals). */
  available: Micros;
  updatedAt: number;
};

export type CreditReason = {
  /** Plain language, e.g. "3 instalments paid on time". */
  label: string;
  /** Score points this fact adds (or removes). */
  points: number;
};

export type CreditLine = {
  limit: Micros;
  available: Micros;
  used: Micros;
  /** 300–850, computed on chain from attested facts. */
  score: number;
  /** Annual rate in basis points: 1000 = 10%. */
  aprBps: number;
  nextPayment: { amount: Micros; dueAt: number; merchant: string; planId: string } | null;
  reasons: CreditReason[];
  /** Whether the buyer brought an outside history (§5.5). */
  historyLinked: boolean;
  /** The opening line never goes past this; higher tiers come from repaying. */
  openingCap: Micros;
};

export type Instalment = {
  index: number;
  amount: Micros;
  dueAt: number;
  paidAt: number | null;
};

export type Plan = {
  id: string;
  loanId: bigint;
  merchant: Merchant;
  description: string;
  principal: Micros;
  interest: Micros;
  interval: number;
  instalments: Instalment[];
  status: "active" | "completed";
  openedAt: number;
};

export type Subscription = {
  id: string;
  subId: bigint;
  merchant: Merchant;
  name: string;
  price: Micros;
  periodSeconds: number;
  nextChargeAt: number;
  startedAt: number;
  status: "active" | "cancelled";
};

export type ActivityKind =
  | "payment"
  | "instalment"
  | "plan-opened"
  | "subscription"
  | "sent-link"
  | "sent"
  | "received"
  | "claimed"
  | "refund"
  | "added";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  /** Who: a merchant or a person. */
  title: string;
  /** What: "Brand identity package", "Instalment 2 of 4", "Sent by link". */
  detail: string;
  direction: "in" | "out";
  amount: Micros;
  at: number;
  counterparty: { kind: "merchant" | "person" | "polaris"; name: string; country?: CountryCode };
  /** Opens the explorer from "View receipt". */
  txHash: Hex;
  /** Only indexed chain events are "settled" (plan §5.6). */
  status: "settled" | "pending";
  /** The Pay in 4 plan it belongs to (plan-opened and instalment rows). */
  planId?: string;
  /** A send link's key, so its sender can take an unclaimed link back. */
  linkKey?: Address;
};

export type PlanOffer = {
  installments: number;
  /** Seconds between instalments. */
  interval: number;
  aprBps: number;
  /** One amount per instalment, on the loan engine's ceil ladder. */
  amounts: Micros[];
  total: Micros;
  interest: Micros;
};

export type SubscriptionOffer = {
  planId: bigint;
  name: string;
  price: Micros;
  periodSeconds: number;
  /** Periods the permit covers up front ("a year of periods", plan §5.3). */
  periodsAuthorised: number;
};

export type PaymentLink = {
  id: string;
  merchant: Merchant;
  description: string;
  amount: Micros;
  /** The merchant's order reference; commits the buyer's signature (§5.2). */
  orderId: string;
  modes: {
    now: boolean;
    later: PlanOffer | null;
    subscription: SubscriptionOffer | null;
  };
  /** Where "Done" returns to, if the merchant sent the buyer here. */
  successUrl: string | null;
  status: "open" | "paid" | "expired";
};

export type SendLinkStatus = {
  linkKey: Address;
  /** Known when the index has seen the link; the fragment carries it otherwise. */
  amount: Micros | null;
  senderName: string | null;
  status: "open" | "claimed" | "cancelled" | "expired";
  expiresAt: number | null;
  settledAt: number | null;
};

/**
 * Every read the app makes. `mock.ts` implements it with placeholder data; a
 * later step swaps in chain reads and the Envio indexer behind the same
 * shape, so no screen changes.
 */
export interface PolarisData {
  getProfile(owner: Address | null): Promise<Profile>;
  getBalance(owner: Address | null): Promise<Balance>;
  getCreditLine(owner: Address | null): Promise<CreditLine>;
  getPlans(owner: Address | null): Promise<{ plans: Plan[]; subscriptions: Subscription[] }>;
  getActivity(owner: Address | null): Promise<ActivityItem[]>;
  getContacts(owner: Address | null): Promise<Person[]>;
  getPaymentLink(id: string): Promise<PaymentLink | null>;
  getSendLink(linkKey: Address): Promise<SendLinkStatus | null>;
  /** Fires when anything above may have changed (new block, indexer event). */
  subscribe(listener: () => void): () => void;
}
