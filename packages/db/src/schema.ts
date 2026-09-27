/**
 * The records Polaris for Business keeps, and the collections that hold them.
 *
 * Money on chain is AUSD base units (6 decimals) as decimal strings, never
 * floats. Session prices are integer cents, the unit merchants think in.
 * Times are ISO-8601 UTC strings unless a field says `Ms` (epoch millis) or
 * `At` on a chain record (unix seconds, as the contracts store them).
 *
 * Secrets never appear in a record except where the server must use them:
 * a secret key is kept only as its hash, and a webhook endpoint keeps its
 * signing secret because every delivery is signed with it.
 */

import { newId } from "./keys.ts";
import type { CollectionSpec, Store } from "./store/types.ts";
import type { WebhookEventType } from "./webhooks.ts";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type IsoDate = string;

/* ── Merchants ──────────────────────────────────────────────────────────── */

export type RegistrationState =
  /** Nothing signed yet. */
  | "none"
  /** registerFor sent; waiting for the block. */
  | "submitted"
  /** In MerchantRegistry, not yet allowed to originate Pay in 4. */
  | "registered"
  /** Registered and activated with a cap. */
  | "active"
  | "failed";

export type MerchantRecord = {
  /** The Privy user id (`did:privy:…`), or `dev:<address>` for a local seed. */
  id: string;
  /** What webhooks and the public API call this merchant: `mer_…`. */
  publicId: string;
  businessName: string | null;
  /** The Privy embedded wallet: where money lands and what signs payouts. */
  walletAddress: Address | null;
  /** Privy's id for that wallet (automatic payouts address it by id). */
  walletId: string | null;
  email: string | null;
  createdAt: IsoDate;
  registration: {
    state: RegistrationState;
    txHash: Hex | null;
    activationTxHash: Hex | null;
    /** The per-order cap set on activation, in AUSD base units. */
    maxOrderUnits: string | null;
    error: string | null;
    updatedAt: IsoDate | null;
  };
  autoPayouts: {
    enabled: boolean;
    payoutAddress: Address | null;
    /** The Privy policy that pins our payout signer to `payoutAddress`. */
    policyId: string | null;
    hourUtc: number;
    nextRunAt: IsoDate | null;
    lastRunAt: IsoDate | null;
    lastError: string | null;
  };
  /** Seeded with sample data because no chain was configured. */
  sample: boolean;
  /** Sample mode only: the balance the sample book implies. */
  sampleBalanceCents: number;
};

/** A new merchant as the dashboard (first Privy session) or a local seed creates one. */
export function newMerchantRecord(input: {
  id: string;
  walletAddress: Address | null;
  walletId?: string | null;
  email?: string | null;
  businessName?: string | null;
  sample?: boolean;
  sampleBalanceCents?: number;
  now?: Date;
}): MerchantRecord {
  return {
    id: input.id,
    publicId: newId("mer", 16),
    businessName: input.businessName ?? null,
    walletAddress: input.walletAddress,
    walletId: input.walletId ?? null,
    email: input.email ?? null,
    createdAt: (input.now ?? new Date()).toISOString(),
    registration: { state: "none", txHash: null, activationTxHash: null, maxOrderUnits: null, error: null, updatedAt: null },
    autoPayouts: { enabled: false, payoutAddress: null, policyId: null, hourUtc: 17, nextRunAt: null, lastRunAt: null, lastError: null },
    sample: input.sample ?? false,
    sampleBalanceCents: input.sampleBalanceCents ?? 0,
  };
}

/* ── API keys ───────────────────────────────────────────────────────────── */

export type ApiKeyRecord = {
  id: string;
  merchantId: string;
  name: string;
  livemode: boolean;
  /** Public by design; stored in full. */
  publishableKey: string;
  /** `sk_test_…a1b2`. */
  secretHint: string;
  /** keys.ts `hashSecretKey`. The secret itself is never stored. */
  secretHash: string;
  createdAt: IsoDate;
  lastUsedAt: IsoDate | null;
  revokedAt: IsoDate | null;
};

/* ── Checkout sessions ──────────────────────────────────────────────────── */

export type CheckoutMode = "now" | "later" | "subscribe";
export type SubscriptionInterval = "day" | "week" | "month" | "year";

export type SessionPayment = {
  mode: CheckoutMode;
  payer: Address;
  txHash: Hex;
  chainId: number;
  paymentId: Hex | null;
  planId: string | null;
  subscriptionId: string | null;
};

/**
 * A settlement of a session's order that didn't match what the session asked
 * for: another amount, a mode it doesn't offer, another subscription plan.
 * It is recorded, it never completes the session, and it sends no success
 * webhook, so a merchant trusting `paymentStatus` never ships for less.
 */
export type SessionMismatch = {
  mode: CheckoutMode;
  payer: Address;
  txHash: Hex;
  /** What was wrong, for the dashboard. */
  reason: string;
  /** What the session asked for and what arrived, in AUSD base units. */
  expectedUnits: string;
  gotUnits: string;
  at: IsoDate;
};

export type CheckoutSessionRecord = {
  /** `cs_test_…`. */
  id: string;
  merchantId: string;
  livemode: boolean;
  status: "open" | "complete" | "expired";
  amountCents: number;
  currency: "USD";
  description: string;
  lineItems: Array<{ name: string; quantity: number; unitAmountCents: number }>;
  modes: CheckoutMode[];
  subscription: { interval: SubscriptionInterval; intervalCount: number } | null;
  successUrl: string;
  cancelUrl: string | null;
  orderId: string | null;
  metadata: Record<string, string>;
  createdAt: IsoDate;
  expiresAt: IsoDate;
  completedAt: IsoDate | null;
  /** The payment link this session was opened from, if any. */
  linkId: string | null;
  /** What the buyer signs against. Fixed at creation. */
  chain: {
    chainId: number;
    /** The merchant's wallet when the session was created. */
    merchant: Address;
    /** The on-chain order id: the merchant's orderId, else the session id. */
    orderId: string;
    /** keccak256(abi.encodePacked(merchant, orderId)): the Pay-now nonce and PolarisPayments payment id. */
    orderKey: Hex;
    /** PolarisPayments plan for "subscribe", created by the relayer. */
    subscriptionPlanId: string | null;
    /**
     * The price pinned on chain with `PolarisPayments.quoteOrder` before the
     * session (and so its order id) was handed out, so the order can only be
     * paid at exactly this price, by any path, relayed or not. Null when no
     * relayer was configured to pin it (development only).
     */
    quote?: { amountUnits: string; txHash: Hex | null; at: IsoDate } | null;
  };
  payment: SessionPayment | null;
  /** Settlements of this order that didn't match the session. */
  mismatches?: SessionMismatch[];
};

/* ── Idempotency ────────────────────────────────────────────────────────── */

export type IdempotencyRecord = {
  /** `<scope>:<key>`, e.g. `sessions:<merchantId>:<Idempotency-Key>`. */
  id: string;
  requestHash: string;
  state: "in_progress" | "done";
  status: number | null;
  /** The response body, as sent. */
  body: string | null;
  createdAt: IsoDate;
  /** Epoch ms after which the key may be reused. */
  expiresAtMs: number;
};

/* ── The relayer ────────────────────────────────────────────────────────── */

export type RelayKind =
  | "pay"
  | "payWithAuthorization"
  | "openPlan"
  | "subscribe"
  | "send"
  | "claim"
  | "cancelSend"
  | "repay"
  | "cancelSubscription"
  | "transfer"
  | "registerMerchant"
  | "activateMerchant"
  | "createSubscriptionPlan"
  | "quoteOrder"
  | "payout";

export type RelayRecord = {
  /** A digest of the signed request: the same signatures relay once. */
  id: string;
  kind: RelayKind;
  state: "pending" | "submitted" | "confirmed" | "failed";
  /** Who signed (the buyer, sender, merchant). */
  signer: Address | null;
  to: Address;
  txHash: Hex | null;
  blockNumber: number | null;
  sessionId: string | null;
  merchantId: string | null;
  /** Ids the receipt yielded: paymentId, loanId, subId, … */
  result: Record<string, string> | null;
  error: { code: string; message: string } | null;
  /** The relayer account that sent it, and the nonce it used, to tell a dropped transaction from a slow one. */
  from?: Address | null;
  nonce?: number | null;
  /** When the reconciler last looked for its receipt; it pages through submitted relays by this. */
  checkedAt?: IsoDate | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
};

/* ── What the chain says happened ───────────────────────────────────────── */

export type PaymentRecord = {
  /**
   * PolarisPayments payment id (the order key) for Pay now, `plan:<loanId>`
   * for a Pay in 4 origination, `sub:<subId>:<period>` for a subscription charge.
   */
  id: string;
  merchantId: string;
  kind: "now" | "later" | "subscription";
  sessionId: string | null;
  linkId: string | null;
  /** The merchant's reference (session orderId), else the chain order id. */
  orderId: string;
  description: string;
  payer: Address;
  amountUnits: string;
  feeUnits: string;
  txHash: Hex;
  blockNumber: number;
  createdAt: IsoDate;
  /**
   * Why this payment didn't settle the session whose order it paid (see
   * `SessionMismatch`). The money is the merchant's either way; the order
   * is not paid.
   */
  mismatch?: string | null;
  sample?: boolean;
};

export type PlanState = "collecting" | "dunning" | "repaid" | "written_off";

export type PlanRecord = {
  /** PolarisLoanEngine loan id. */
  id: string;
  merchantId: string;
  sessionId: string | null;
  orderId: string;
  description: string;
  borrower: Address;
  principalUnits: string;
  totalOwedUnits: string;
  repaidUnits: string;
  installments: number;
  installmentsPaid: number;
  intervalSeconds: number;
  /** Unix seconds; instalment i (0-based) is due at startedAt + (i+1)·interval. */
  startedAt: number;
  state: PlanState;
  /** Failed collections of the current instalment. */
  attempts: number;
  lastFailure: { reason: string; at: IsoDate; nextAttemptAt: IsoDate | null } | null;
  openedTxHash: Hex;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  sample?: boolean;
};

export type SubscriptionRecord = {
  /** PolarisPayments subscription id. */
  id: string;
  merchantId: string;
  planId: string;
  subscriber: Address;
  priceUnits: string;
  periodSeconds: number;
  periodsCharged: number;
  /** Unix seconds. */
  nextChargeAt: number;
  status: "active" | "canceled" | "lapsed";
  orderId: string | null;
  sessionId: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
};

export type SubscriptionPlanRecord = {
  /** PolarisPayments plan id. */
  id: string;
  merchantId: string;
  merchant: Address;
  /** `<merchant>:<priceUnits>:<periodSeconds>`: one plan per price and period. */
  terms: string;
  priceUnits: string;
  periodSeconds: number;
  name: string;
  txHash: Hex | null;
  createdAt: IsoDate;
};

export type PayoutRecord = {
  id: string;
  merchantId: string;
  kind: "manual" | "automatic";
  state: "queued" | "submitted" | "paid" | "failed";
  amountUnits: string;
  from: Address;
  destination: Address;
  /** The ERC-3009 nonce the merchant's wallet signed. */
  authorizationNonce: Hex | null;
  txHash: Hex | null;
  error: string | null;
  createdAt: IsoDate;
  paidAt: IsoDate | null;
  sample?: boolean;
};

/* ── Payment links ──────────────────────────────────────────────────────── */

export type LinkRecord = {
  id: string;
  merchantId: string;
  url: string;
  amountCents: number;
  description: string;
  modes: CheckoutMode[];
  usage: "single" | "reusable";
  expiresAt: IsoDate | null;
  status: "active" | "used" | "expired";
  paymentsCount: number;
  collectedCents: number;
  createdAt: IsoDate;
  sample?: boolean;
};

/* ── Webhooks ───────────────────────────────────────────────────────────── */

export type WebhookEndpointRecord = {
  id: string;
  merchantId: string;
  url: string;
  events: WebhookEventType[];
  /** The whole `whsec_…` string; every delivery is signed with it. */
  secret: string;
  secretHint: string;
  createdAt: IsoDate;
  disabledAt: IsoDate | null;
};

export type WebhookEventRecord = {
  /** `evt_…`. */
  id: string;
  merchantId: string;
  type: WebhookEventType;
  livemode: boolean;
  createdAt: IsoDate;
  /** The exact body every delivery of this event sends. */
  body: string;
  /** Dedupes chain-sourced events: `<txHash>:<logIndex>:<type>`, or `test:<id>`. */
  sourceKey: string;
  test: boolean;
};

export type DeliveryAttempt = {
  at: IsoDate;
  status: number | null;
  durationMs: number;
  error: string | null;
  responseBody: string | null;
};

export type WebhookDeliveryRecord = {
  /** `del_…`. */
  id: string;
  merchantId: string;
  endpointId: string;
  eventId: string;
  type: WebhookEventType;
  url: string;
  state: "pending" | "delivering" | "succeeded" | "failed";
  /** Attempts made so far. */
  attempts: DeliveryAttempt[];
  /** Epoch ms of the next attempt; null once it succeeded or gave up. */
  nextAttemptAtMs: number | null;
  /** Epoch ms until which a dispatcher owns this delivery. */
  lockedUntilMs: number;
  /** The headers and body of the last attempt. */
  request: { headers: Record<string, string>; body: string } | null;
  test: boolean;
  createdAt: IsoDate;
  updatedAt: IsoDate;
};

/* ── Chain sync bookkeeping ─────────────────────────────────────────────── */

export type ChainCursorRecord = { id: string; block: number; updatedAt: IsoDate };
/** A chain log we have handled: `<txHash>:<logIndex>`. Claimed before handling, released if handling fails. */
export type ProcessedLogRecord = { id: string; txHash: Hex; blockNumber: number; at: IsoDate };
/**
 * A chain log whose handler failed: `<txHash>:<logIndex>`. After a few
 * failures it is dead-lettered (`deadAt`), left claimed and skipped, so one
 * bad log can't hold the chain-sync cursor (and every event behind it) for
 * good. Kept for someone to look at and replay.
 */
export type FailedLogRecord = {
  id: string;
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
  event: string;
  attempts: number;
  lastError: string;
  firstFailedAt: IsoDate;
  lastFailedAt: IsoDate;
  deadAt: IsoDate | null;
};
export type CollectorRunRecord = {
  id: string;
  lastRunAt: IsoDate | null;
  lastRunBlock: number | null;
  lastTxHash: Hex | null;
  tasks: number;
  executed: number;
  skipped: number;
};

/* ── Credit: CRE underwriting requests and outcomes ─────────────────────── */

/** One signed request to underwrite a Polaris account, queued for the CRE underwriting workflow's HTTP trigger. */
export type UnderwritingRequestRecord = {
  /** `uwr_…`. */
  id: string;
  /** The Polaris account (lower-case), which signed the consent. */
  account: Address;
  /** The history wallet it links, or null for the account alone. */
  wallet: Address | null;
  /** Exactly what the trigger receives as `input` (the workflow verifies the signatures itself). */
  payload: {
    user: Address;
    consent: { issuedAt: number; nonce: string; signature: Hex };
    linked: { wallet: Address; issuedAt: number; nonce: string; signature: Hex } | null;
  };
  /** queued → sent (the trigger accepted it) → done (the workflow's callback came back), or failed. */
  state: "queued" | "sent" | "done" | "failed";
  attempts: number;
  error: string | null;
  createdAt: IsoDate;
  sentAt: IsoDate | null;
  doneAt: IsoDate | null;
};

/** What the CRE underwriting workflow decided for an account, from its signed callback. */
export type CreditDecisionRecord = {
  /** The account, lower-case. */
  id: string;
  /** `applied`: ScoreManager opened the line; `refused`: the receiver refused it; `thin`: no report, not enough evidence yet. */
  status: "applied" | "refused" | "thin";
  score: number | null;
  reason: string | null;
  linkedWallet: Address | null;
  txHash: Hex | null;
  /** The callback's own id, and when it arrived. */
  callbackId: string;
  at: IsoDate;
};

/** A CRE callback we have handled, by its id: every DON node may deliver it. */
export type CreCallbackRecord = { id: string; type: string; receivedAt: IsoDate };

/* ── Collections ────────────────────────────────────────────────────────── */

const lower = (a: string | null | undefined) => (a ? a.toLowerCase() : null);

export const COLLECTIONS = {
  merchants: {
    name: "merchants",
    id: (d: MerchantRecord) => d.id,
    indexes: {
      publicId: (d: MerchantRecord) => d.publicId,
      wallet: (d: MerchantRecord) => lower(d.walletAddress),
      autoPayouts: (d: MerchantRecord) => d.autoPayouts.enabled,
      createdAt: (d: MerchantRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<MerchantRecord>,
  apiKeys: {
    name: "api_keys",
    id: (d: ApiKeyRecord) => d.id,
    indexes: {
      merchantId: (d: ApiKeyRecord) => d.merchantId,
      secretHash: (d: ApiKeyRecord) => d.secretHash,
      publishableKey: (d: ApiKeyRecord) => d.publishableKey,
      createdAt: (d: ApiKeyRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<ApiKeyRecord>,
  sessions: {
    name: "checkout_sessions",
    id: (d: CheckoutSessionRecord) => d.id,
    indexes: {
      merchantId: (d: CheckoutSessionRecord) => d.merchantId,
      orderKey: (d: CheckoutSessionRecord) => d.chain.orderKey.toLowerCase(),
      status: (d: CheckoutSessionRecord) => d.status,
      linkId: (d: CheckoutSessionRecord) => d.linkId,
      createdAt: (d: CheckoutSessionRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<CheckoutSessionRecord>,
  idempotency: {
    name: "idempotency_keys",
    id: (d: IdempotencyRecord) => d.id,
    indexes: { expiresAtMs: (d: IdempotencyRecord) => d.expiresAtMs },
  } satisfies CollectionSpec<IdempotencyRecord>,
  relays: {
    name: "relays",
    id: (d: RelayRecord) => d.id,
    indexes: {
      txHash: (d: RelayRecord) => lower(d.txHash),
      sessionId: (d: RelayRecord) => d.sessionId,
      state: (d: RelayRecord) => d.state,
      createdAt: (d: RelayRecord) => d.createdAt,
      checkedAt: (d: RelayRecord) => d.checkedAt ?? d.createdAt,
    },
  } satisfies CollectionSpec<RelayRecord>,
  payments: {
    name: "payments",
    id: (d: PaymentRecord) => d.id,
    indexes: {
      merchantId: (d: PaymentRecord) => d.merchantId,
      sessionId: (d: PaymentRecord) => d.sessionId,
      createdAt: (d: PaymentRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<PaymentRecord>,
  plans: {
    name: "plans",
    id: (d: PlanRecord) => d.id,
    indexes: {
      merchantId: (d: PlanRecord) => d.merchantId,
      state: (d: PlanRecord) => d.state,
      createdAt: (d: PlanRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<PlanRecord>,
  subscriptions: {
    name: "subscriptions",
    id: (d: SubscriptionRecord) => d.id,
    indexes: {
      merchantId: (d: SubscriptionRecord) => d.merchantId,
      createdAt: (d: SubscriptionRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<SubscriptionRecord>,
  subscriptionPlans: {
    name: "subscription_plans",
    id: (d: SubscriptionPlanRecord) => d.id,
    indexes: { terms: (d: SubscriptionPlanRecord) => d.terms.toLowerCase(), merchantId: (d: SubscriptionPlanRecord) => d.merchantId },
  } satisfies CollectionSpec<SubscriptionPlanRecord>,
  payouts: {
    name: "payouts",
    id: (d: PayoutRecord) => d.id,
    indexes: {
      merchantId: (d: PayoutRecord) => d.merchantId,
      state: (d: PayoutRecord) => d.state,
      txHash: (d: PayoutRecord) => lower(d.txHash),
      createdAt: (d: PayoutRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<PayoutRecord>,
  links: {
    name: "payment_links",
    id: (d: LinkRecord) => d.id,
    indexes: { merchantId: (d: LinkRecord) => d.merchantId, createdAt: (d: LinkRecord) => d.createdAt },
  } satisfies CollectionSpec<LinkRecord>,
  webhookEndpoints: {
    name: "webhook_endpoints",
    id: (d: WebhookEndpointRecord) => d.id,
    indexes: { merchantId: (d: WebhookEndpointRecord) => d.merchantId, createdAt: (d: WebhookEndpointRecord) => d.createdAt },
  } satisfies CollectionSpec<WebhookEndpointRecord>,
  webhookEvents: {
    name: "webhook_events",
    id: (d: WebhookEventRecord) => d.id,
    indexes: {
      merchantId: (d: WebhookEventRecord) => d.merchantId,
      sourceKey: (d: WebhookEventRecord) => d.sourceKey,
      createdAt: (d: WebhookEventRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<WebhookEventRecord>,
  webhookDeliveries: {
    name: "webhook_deliveries",
    id: (d: WebhookDeliveryRecord) => d.id,
    indexes: {
      merchantId: (d: WebhookDeliveryRecord) => d.merchantId,
      eventId: (d: WebhookDeliveryRecord) => d.eventId,
      state: (d: WebhookDeliveryRecord) => d.state,
      nextAttemptAtMs: (d: WebhookDeliveryRecord) => d.nextAttemptAtMs,
      createdAt: (d: WebhookDeliveryRecord) => d.createdAt,
    },
  } satisfies CollectionSpec<WebhookDeliveryRecord>,
  cursors: {
    name: "chain_cursors",
    id: (d: ChainCursorRecord) => d.id,
    indexes: {},
  } satisfies CollectionSpec<ChainCursorRecord>,
  processedLogs: {
    name: "processed_logs",
    id: (d: ProcessedLogRecord) => d.id,
    indexes: { blockNumber: (d: ProcessedLogRecord) => d.blockNumber },
  } satisfies CollectionSpec<ProcessedLogRecord>,
  collectorRuns: {
    name: "collector_runs",
    id: (d: CollectorRunRecord) => d.id,
    indexes: {},
  } satisfies CollectionSpec<CollectorRunRecord>,
  underwritingRequests: {
    name: "underwriting_requests",
    id: (d: UnderwritingRequestRecord) => d.id,
    indexes: {
      account: (d: UnderwritingRequestRecord) => d.account.toLowerCase(),
      state: (d: UnderwritingRequestRecord) => d.state,
      createdAt: (d: UnderwritingRequestRecord) => d.createdAt,
      sentAt: (d: UnderwritingRequestRecord) => d.sentAt,
    },
  } satisfies CollectionSpec<UnderwritingRequestRecord>,
  creditDecisions: {
    name: "credit_decisions",
    id: (d: CreditDecisionRecord) => d.id,
    indexes: { at: (d: CreditDecisionRecord) => d.at },
  } satisfies CollectionSpec<CreditDecisionRecord>,
  creCallbacks: {
    name: "cre_callbacks",
    id: (d: CreCallbackRecord) => d.id,
    indexes: { receivedAt: (d: CreCallbackRecord) => d.receivedAt },
  } satisfies CollectionSpec<CreCallbackRecord>,
  failedLogs: {
    name: "failed_logs",
    id: (d: FailedLogRecord) => d.id,
    indexes: { blockNumber: (d: FailedLogRecord) => d.blockNumber, dead: (d: FailedLogRecord) => d.deadAt !== null },
  } satisfies CollectionSpec<FailedLogRecord>,
} as const;

/** Every collection, typed, over one store. */
export function collections(store: Store) {
  return {
    merchants: store.collection(COLLECTIONS.merchants),
    apiKeys: store.collection(COLLECTIONS.apiKeys),
    sessions: store.collection(COLLECTIONS.sessions),
    idempotency: store.collection(COLLECTIONS.idempotency),
    relays: store.collection(COLLECTIONS.relays),
    payments: store.collection(COLLECTIONS.payments),
    plans: store.collection(COLLECTIONS.plans),
    subscriptions: store.collection(COLLECTIONS.subscriptions),
    subscriptionPlans: store.collection(COLLECTIONS.subscriptionPlans),
    payouts: store.collection(COLLECTIONS.payouts),
    links: store.collection(COLLECTIONS.links),
    webhookEndpoints: store.collection(COLLECTIONS.webhookEndpoints),
    webhookEvents: store.collection(COLLECTIONS.webhookEvents),
    webhookDeliveries: store.collection(COLLECTIONS.webhookDeliveries),
    cursors: store.collection(COLLECTIONS.cursors),
    processedLogs: store.collection(COLLECTIONS.processedLogs),
    collectorRuns: store.collection(COLLECTIONS.collectorRuns),
    failedLogs: store.collection(COLLECTIONS.failedLogs),
    underwritingRequests: store.collection(COLLECTIONS.underwritingRequests),
    creditDecisions: store.collection(COLLECTIONS.creditDecisions),
    creCallbacks: store.collection(COLLECTIONS.creCallbacks),
  };
}

export type Collections = ReturnType<typeof collections>;
