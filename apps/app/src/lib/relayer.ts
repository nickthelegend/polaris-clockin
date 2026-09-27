import { type Address, type Hex, isHex, type TypedDataDomain } from "viem";
import { ApiError, api, apiConfigured } from "./api";
import { receiptUrl } from "./chain";
import { mockLedger } from "./data/mock";
import type { PaymentLink, Person } from "./data/types";
import type { Micros } from "./money";
import type { Authorization, Cancel, CancelSubscription, Claim, Open, Permit, PlanIntent, RepayIntent, SubscribeIntent } from "./sign";

/**
 * The relayer carries signatures to the chain (plan §5.3). The app signs; the
 * relayer, a policy-locked Privy server wallet run by Polaris for Business,
 * checks each signature, simulates the call and sends it, paying the gas. The
 * app never sends a transaction and the buyer never holds MON.
 *
 * With `NEXT_PUBLIC_POLARIS_API_URL` set, every request goes to
 * `POST {api}/api/relay` (apps/business/src/server/relayer/relay.ts has the
 * request shapes) and "Paid" comes from the transaction's own events, which
 * the server reads from the receipt. Without it, a local stub checks shapes,
 * waits about as long as Monad takes to finalise, and writes to the sample
 * ledger, so the app still works as a demo offline.
 */

export type Signed<T> = { message: T; signature: Hex; domain: TypedDataDomain };

export type RelayReceipt = {
  txHash: Hex;
  /** When the relayer submitted and when the block was final. */
  submittedAt: number;
  finalizedAt: number;
  /** The explorer page; the only way the buyer ever reaches it is "View receipt". */
  explorerUrl: string;
  /** From the transaction's events, when the relayer saw them. */
  paymentId?: string;
  planId?: string;
  subscriptionId?: string;
};

/** PolarisCheckout.pay */
export type PayNowRequest = { link: PaymentLink; payer: Address; authorization: Signed<Authorization> };

/** PolarisCheckout.openPlan: two signatures, one Confirm. */
export type OpenPlanRequest = { link: PaymentLink; intent: Signed<PlanIntent>; permit: Signed<Permit> };

/** PolarisCheckout.subscribe */
export type SubscribeRequest = { link: PaymentLink; intent: Signed<SubscribeIntent>; permit: Signed<Permit> };

/** PolarisSend.send: the sender's authorisation, and the link key's Open. */
export type SendRequest = {
  sender: Address;
  senderName: string;
  linkKey: Address;
  amount: Micros;
  expiresAt: bigint;
  authorization: Signed<Authorization>;
  open: Signed<Open>;
};

/** PolarisSend.claim(linkKey, to, deadline, v, r, s): signed by the link's key, naming the recipient. */
export type ClaimRequest = {
  linkKey: Address;
  claim: Signed<Claim>;
  /** The same deadline the claim signs; PolarisSend takes it as its own argument. */
  deadline: bigint;
  /** Display only, from the link. The chain pays what was escrowed. */
  amount: Micros;
  senderName: string;
};

/** PolarisSend.cancel */
export type CancelSendRequest = { cancel: Signed<Cancel> };

/** PolarisPayments.cancelWithSignature */
export type CancelSubscriptionRequest = { cancel: Signed<CancelSubscription> };

/** AUSD transferWithAuthorization: send to someone who already has Polaris. */
export type TransferRequest = { to: Person; authorization: Signed<Authorization> };

/** PolarisLoanEngine.repayWithSig: pay a plan early. */
export type PayEarlyRequest = { planId: string; loanId: bigint; borrower: Address; repay: Signed<RepayIntent> };

export interface Relayer {
  payNow(request: PayNowRequest): Promise<RelayReceipt>;
  openPlan(request: OpenPlanRequest): Promise<RelayReceipt>;
  subscribe(request: SubscribeRequest): Promise<RelayReceipt>;
  send(request: SendRequest): Promise<RelayReceipt>;
  claim(request: ClaimRequest): Promise<RelayReceipt>;
  cancelSend(request: CancelSendRequest): Promise<RelayReceipt>;
  cancelSubscription(request: CancelSubscriptionRequest): Promise<RelayReceipt>;
  transfer(request: TransferRequest): Promise<RelayReceipt>;
  payEarly(request: PayEarlyRequest): Promise<RelayReceipt>;
}

export type RelayErrorReason = "insufficient-funds" | "over-limit" | "invalid-signature" | "already-settled" | "expired" | "unavailable";

export class RelayError extends Error {
  readonly reason: RelayErrorReason;
  readonly code: string | undefined;
  constructor(reason: RelayErrorReason, message: string, code?: string) {
    super(message);
    this.name = "RelayError";
    this.reason = reason;
    this.code = code;
  }
}

/** True while the relayer is the local stub (no Polaris API configured). */
export const RELAYER_IS_STUB = !apiConfigured();

/* ── The real relayer: POST /api/relay ──────────────────────────────────── */

const REASONS: Record<string, RelayErrorReason> = {
  insufficient_funds: "insufficient-funds",
  over_limit: "over-limit",
  credit_unavailable: "over-limit",
  merchant_not_eligible: "over-limit",
  invalid_signature: "invalid-signature",
  stale_signature: "invalid-signature",
  signature_expired: "expired",
  session_expired: "expired",
  link_expired: "expired",
  already_paid: "already-settled",
  already_used: "already-settled",
  link_used: "already-settled",
  payment_in_progress: "already-settled",
};

type RelayResponse = {
  txHash: Hex;
  status: "submitted" | "confirmed";
  explorerUrl: string | null;
  submittedAt: number;
  confirmedAt: number | null;
  paymentId?: string;
  planId?: string;
  subscriptionId?: string;
};

async function relay(body: Record<string, unknown>): Promise<RelayReceipt> {
  let out: RelayResponse;
  try {
    out = await api<RelayResponse>("/api/relay", { method: "POST", body });
  } catch (error) {
    if (error instanceof ApiError) throw new RelayError(REASONS[error.code] ?? "unavailable", error.message, error.code);
    throw error;
  }
  return {
    txHash: out.txHash,
    submittedAt: out.submittedAt,
    finalizedAt: out.confirmedAt ?? Date.now(),
    explorerUrl: out.explorerUrl ?? receiptUrl(out.txHash),
    paymentId: out.paymentId,
    planId: out.planId,
    subscriptionId: out.subscriptionId,
  };
}

const str = (v: bigint | number) => v.toString();

function permitBody(permit: Signed<Permit>) {
  return { value: str(permit.message.value), deadline: str(permit.message.deadline), signature: permit.signature };
}

const httpRelayer: Relayer = {
  payNow: ({ link, payer, authorization }) =>
    relay({
      type: "pay",
      sessionId: link.id,
      buyer: payer,
      amount: str(authorization.message.value),
      validAfter: str(authorization.message.validAfter),
      validBefore: str(authorization.message.validBefore),
      signature: authorization.signature,
    }),
  openPlan: ({ link, intent, permit }) =>
    relay({
      type: "openPlan",
      sessionId: link.id,
      intent: {
        buyer: intent.message.buyer,
        principal: str(intent.message.principal),
        installments: str(intent.message.installments),
        interval: str(intent.message.interval),
        nonce: str(intent.message.nonce),
        deadline: str(intent.message.deadline),
      },
      signature: intent.signature,
      permit: permitBody(permit),
    }),
  subscribe: ({ link, intent, permit }) =>
    relay({
      type: "subscribe",
      sessionId: link.id,
      intent: {
        buyer: intent.message.buyer,
        planId: str(intent.message.planId),
        pricePerPeriod: str(intent.message.pricePerPeriod),
        periodSeconds: str(intent.message.periodSeconds),
        nonce: str(intent.message.nonce),
        deadline: str(intent.message.deadline),
      },
      signature: intent.signature,
      permit: permitBody(permit),
    }),
  send: ({ sender, linkKey, amount, expiresAt, authorization, open }) =>
    relay({
      type: "send",
      sender,
      linkKey,
      amount: str(amount),
      expiresAt: str(expiresAt),
      validAfter: str(authorization.message.validAfter),
      validBefore: str(authorization.message.validBefore),
      signature: authorization.signature,
      linkSignature: open.signature,
    }),
  claim: ({ linkKey, claim }) => relay({ type: "claim", linkKey, to: claim.message.to, deadline: str(claim.message.deadline), signature: claim.signature }),
  cancelSend: ({ cancel }) => relay({ type: "cancelSend", linkKey: cancel.message.linkKey, deadline: str(cancel.message.deadline), signature: cancel.signature }),
  cancelSubscription: ({ cancel }) =>
    relay({ type: "cancelSubscription", subId: str(cancel.message.subId), deadline: str(cancel.message.deadline), signature: cancel.signature }),
  transfer: ({ authorization }) =>
    relay({
      type: "transfer",
      from: authorization.message.from,
      to: authorization.message.to,
      value: str(authorization.message.value),
      validAfter: str(authorization.message.validAfter),
      validBefore: str(authorization.message.validBefore),
      nonce: authorization.message.nonce,
      signature: authorization.signature,
    }),
  payEarly: ({ repay }) =>
    relay({
      type: "repay",
      loanId: str(repay.message.loanId),
      amount: str(repay.message.amount),
      expectedRepaid: str(repay.message.expectedRepaid),
      deadline: str(repay.message.deadline),
      signature: repay.signature,
    }),
};

/* ── The stub: shapes only, sample ledger, no network ───────────────────── */

const FINALITY_MS = 800;

function assertSignature(signed: { signature: Hex }): void {
  // 65 bytes: r ‖ s ‖ v.
  if (!isHex(signed.signature) || signed.signature.length !== 132) {
    throw new RelayError("invalid-signature", "That confirmation didn't go through. Try again.");
  }
}

function fakeTxHash(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function settle(effect: (txHash: Hex) => void): Promise<RelayReceipt> {
  const submittedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, FINALITY_MS));
  const txHash = fakeTxHash();
  effect(txHash);
  return { txHash, submittedAt, finalizedAt: Date.now(), explorerUrl: receiptUrl(txHash) };
}

function needBalance(amount: Micros): void {
  if (mockLedger.balance() < amount) {
    throw new RelayError("insufficient-funds", "Not enough dollars in your account for this.");
  }
}

const stubRelayer: Relayer = {
  async payNow({ link, authorization }) {
    assertSignature(authorization);
    needBalance(authorization.message.value);
    return settle((tx) => mockLedger.payNow(link, tx));
  },
  async openPlan({ link, intent, permit }) {
    assertSignature(intent);
    assertSignature(permit);
    const offer = link.modes.later;
    if (!offer) throw new RelayError("over-limit", "This link doesn't offer Pay in 4.");
    if (mockLedger.creditAvailable() < offer.total) {
      throw new RelayError("over-limit", "This is more than your limit right now.");
    }
    // Nothing moves from the buyer at origination: the merchant is paid from the pool.
    return settle((tx) => mockLedger.openPlan(link, tx));
  },
  async subscribe({ link, intent, permit }) {
    assertSignature(intent);
    assertSignature(permit);
    needBalance(link.modes.subscription?.price ?? link.amount);
    return settle((tx) => mockLedger.subscribe(link, tx));
  },
  async send({ linkKey, amount, senderName, expiresAt, authorization, open }) {
    assertSignature(authorization);
    assertSignature(open);
    needBalance(amount);
    return settle((tx) => mockLedger.send(linkKey, amount, senderName, Number(expiresAt) * 1000, tx));
  },
  async claim({ linkKey, claim, deadline, amount, senderName }) {
    assertSignature(claim);
    if (claim.message.deadline !== deadline) {
      throw new RelayError("invalid-signature", "That claim didn't go through. Try again.");
    }
    return settle((tx) => mockLedger.claim(linkKey, amount, senderName, tx));
  },
  async cancelSend({ cancel }) {
    assertSignature(cancel);
    return settle((tx) => mockLedger.cancelSend(cancel.message.linkKey, tx));
  },
  async cancelSubscription({ cancel }) {
    assertSignature(cancel);
    return settle(() => mockLedger.cancelSubscription(cancel.message.subId));
  },
  async transfer({ to, authorization }) {
    assertSignature(authorization);
    needBalance(authorization.message.value);
    return settle((tx) => mockLedger.transfer(to, authorization.message.value, tx));
  },
  async payEarly({ planId, repay }) {
    assertSignature(repay);
    return settle((tx) => mockLedger.payEarly(planId, tx));
  },
};

export const relayer: Relayer = RELAYER_IS_STUB ? stubRelayer : httpRelayer;
