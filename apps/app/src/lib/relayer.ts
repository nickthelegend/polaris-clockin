import { type Address, type Hex, isHex, type TypedDataDomain } from "viem";
import { receiptUrl } from "./chain";
import { mockLedger } from "./data/mock";
import type { PaymentLink, Person } from "./data/types";
import type { Micros } from "./money";
import type { Authorization, Cancel, CancelSubscription, Claim, Permit, PlanIntent, SubscribeIntent } from "./sign";

/**
 * The relayer carries signatures to the chain (plan §5.3). The app signs; the
 * relayer, a policy-locked Privy server wallet, calls the contract and pays
 * the gas. The app never sends a transaction.
 *
 * THIS IS A STUB. It checks each request's shape, waits about as long as
 * Monad takes to finalise, and returns a made-up receipt. It also writes to
 * the placeholder ledger so the rest of the app reflects the action. The real
 * client POSTs the same requests to the relay API, and "Paid" then comes from
 * the indexed chain event, never from the client (§5.6).
 */

export type Signed<T> = { message: T; signature: Hex; domain: TypedDataDomain };

export type RelayReceipt = {
  txHash: Hex;
  /** When the relayer submitted and when the block was final. */
  submittedAt: number;
  finalizedAt: number;
  /** The explorer page; the only way the buyer ever reaches it is "View receipt". */
  explorerUrl: string;
};

/** PolarisPayments.payWithAuthorization */
export type PayNowRequest = {
  link: PaymentLink;
  payer: Address;
  authorization: Signed<Authorization>;
};

/** PolarisCheckout.openPlan: two signatures, one Confirm. */
export type OpenPlanRequest = {
  link: PaymentLink;
  intent: Signed<PlanIntent>;
  permit: Signed<Permit>;
};

/** PolarisCheckout.subscribe */
export type SubscribeRequest = {
  link: PaymentLink;
  intent: Signed<SubscribeIntent>;
  permit: Signed<Permit>;
};

/** PolarisSend.send */
export type SendRequest = {
  sender: Address;
  senderName: string;
  linkKey: Address;
  amount: Micros;
  expiresAt: bigint;
  authorization: Signed<Authorization>;
};

/** PolarisSend.claim: signed by the link's key, naming the recipient. */
export type ClaimRequest = {
  linkKey: Address;
  claim: Signed<Claim>;
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

/**
 * Early repayment. The loan engine's signed early-repayment entry point isn't
 * specified yet (plan §5.2 item 5 covers scheduled collection only), so the
 * request carries the plan and the account; the typed data lands with it.
 */
export type PayEarlyRequest = { planId: string; loanId: bigint; borrower: Address };

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

export class RelayError extends Error {
  readonly reason: "insufficient-funds" | "over-limit" | "invalid-signature" | "already-settled";
  constructor(reason: RelayError["reason"], message: string) {
    super(message);
    this.name = "RelayError";
    this.reason = reason;
  }
}

/** True while the relayer is the stub, so callers can tolerate placeholder domains. */
export const RELAYER_IS_STUB = true;

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

export const relayer: Relayer = {
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
    needBalance(offer.amounts[0] ?? 0n);
    return settle((tx) => mockLedger.openPlan(link, tx));
  },
  async subscribe({ link, intent, permit }) {
    assertSignature(intent);
    assertSignature(permit);
    needBalance(link.modes.subscription?.price ?? link.amount);
    return settle((tx) => mockLedger.subscribe(link, tx));
  },
  async send({ linkKey, amount, senderName, expiresAt, authorization }) {
    assertSignature(authorization);
    needBalance(amount);
    return settle((tx) => mockLedger.send(linkKey, amount, senderName, Number(expiresAt) * 1000, tx));
  },
  async claim({ linkKey, claim, amount, senderName }) {
    assertSignature(claim);
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
  async payEarly({ planId }) {
    return settle((tx) => mockLedger.payEarly(planId, tx));
  },
};
