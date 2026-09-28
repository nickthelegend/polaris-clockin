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
  /** Where the fact came from, when a provider supplied it: "Nansen", "Zerion". */
  source?: string | null;
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
  /** When the line opened (the CRE decision); null when not known. The sample book leaves it out. */
  openedAt?: number | null;
  /** The score the line opened with; its history starts there. */
  openingScore?: number | null;
  /**
   * The report behind the line: the transaction the Chainlink CRE
   * underwriting workflow wrote, and when. Null until one exists (and in the
   * offline demo, whose line nobody attested).
   */
  verified: CreditProvenance | null;
};

/** "Verified by Chainlink CRE": the underwriting report's transaction. */
export type CreditProvenance = {
  by: "Chainlink CRE";
  /** The CRE workflow that wrote it: polaris-underwrite. */
  workflow: string;
  txHash: Hex;
  /** Null on a local chain, which has no explorer. */
  explorerUrl: string | null;
  /** When the report landed (its block time), ms. */
  at: number;
};

/**
 * The risk guard (the Chainlink CRE guardian's verdict, as PolarisCheckout
 * applies it to new Pay in 4 plans). A stale guard fails open: Pay in 4
 * keeps working and the screens say when it last checked.
 */
export type CreditGuardView = {
  state: "open" | "paused" | "stale" | "never" | "unconfigured" | "unavailable";
  paused: boolean;
  /** What the buyer reads while it is paused. */
  message: string | null;
  /** Seconds since it last checked, as of `readAt`; null before the first check. */
  ageSeconds: number | null;
  /** When the API read it, ms. */
  readAt: number;
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
  /** Collections: why the current payment wasn't taken, and signing again for a lost approval. Absent in the offline demo. */
  collection?: PlanCollection;
};

export type PlanCollection = {
  /** The last failed collection of the current payment, and when it is tried again. */
  failure: { reason: "insufficient_funds" | "allowance_lost" | "other"; at: number; nextAttemptAt: number | null } | null;
  /** Polaris can no longer take this plan's payments: the buyer signs once more (PolarisCheckout.reauthorize). */
  needsSignature: boolean;
  /** They signed again, and the collection that followed (the CRE collections run), once it lands. */
  reauthorized: { at: number; txHash: Hex; collected: { at: number; txHash: Hex } | null } | null;
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
  /** `category` is the merchant's ("Groceries", "Café"), for spending by category. */
  counterparty: { kind: "merchant" | "person" | "polaris"; name: string; country?: CountryCode; category?: string };
  /** Opens the explorer from "View receipt". */
  txHash: Hex;
  /** Only indexed chain events are "settled" (plan §5.6). */
  status: "settled" | "pending";
  /** The Pay in 4 plan it belongs to (plan-opened and instalment rows). */
  planId?: string;
  /** A send link's key, so its sender can take an unclaimed link back. */
  linkKey?: Address;
  /** A sent link: when it was claimed (or taken back). */
  settledAt?: number;
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
  /**
   * Set when this is a real checkout session from Polaris for Business
   * (`/api/public/sessions/{id}`); absent for sample links.
   */
  session?: CheckoutSessionInfo;
};

export type CheckoutSessionInfo = {
  /** The merchant page that opened the checkout, for `postMessage` (never "*"). */
  returnOrigin: string;
  cancelUrl: string | null;
  expiresAt: number;
  /** Why Pay in 4 isn't offered, in the buyer's words, when it isn't. */
  payLaterUnavailable: string | null;
  /** The risk guard as the checkout read it: paused (Pay in 4 shown as unavailable) or stale ("last checked 72 min ago"). */
  creditGuard: CreditGuardView | null;
  /** The way to pay the merchant's page chose (the session's first mode): the checkout opens on it. */
  preferredMode: "now" | "later" | "subscription" | null;
  /** How it was paid, once the chain says so. */
  payment: {
    mode: "now" | "later" | "subscribe";
    txHash: Hex;
    paymentId: Hex | null;
    planId: string | null;
    subscriptionId: string | null;
  } | null;
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
  /** The risk guard now; null when there is none to show (the offline demo). */
  getCreditGuard(): Promise<CreditGuardView | null>;
  getPlans(owner: Address | null): Promise<{ plans: Plan[]; subscriptions: Subscription[] }>;
  getActivity(owner: Address | null): Promise<ActivityItem[]>;
  getContacts(owner: Address | null): Promise<Person[]>;
  getPaymentLink(id: string): Promise<PaymentLink | null>;
  getSendLink(linkKey: Address): Promise<SendLinkStatus | null>;
  /** Fires when anything above may have changed (new block, indexer event). */
  subscribe(listener: () => void): () => void;
}
