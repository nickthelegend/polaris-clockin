/**
 * EIP-712 struct definitions, field for field with the contracts.
 *
 * Each `*_TYPE` string is the exact preimage of the contract's typehash
 * (`keccak256("PlanIntent(address borrower,...)")`). `scripts/verify-signatures.ts`
 * rebuilds every string from the field lists below and checks the digest viem
 * signs equals the one the contract computes, so the two cannot drift silently.
 *
 * Field order matters: EIP-712 hashes fields in declaration order.
 */

/** PolarisCheckout: open a Pay in 4 plan. `nonce` is PolarisCheckout.nonces(buyer), shared with SubscribeIntent. */
export const PLAN_INTENT_TYPE =
  "PlanIntent(address buyer,address merchant,uint256 principal,uint32 installments,uint64 interval,string orderId,uint256 nonce,uint256 deadline)";

/** PolarisCheckout: start a subscription to a merchant's plan, at the plan's own price and period. */
export const SUBSCRIBE_INTENT_TYPE =
  "SubscribeIntent(address buyer,address merchant,uint256 planId,uint256 pricePerPeriod,uint64 periodSeconds,string orderId,uint256 nonce,uint256 deadline)";

/** ERC-3009: only the payee (`to`) may submit it. */
export const RECEIVE_WITH_AUTHORIZATION_TYPE =
  "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

/** ERC-3009: anyone may submit it. */
export const TRANSFER_WITH_AUTHORIZATION_TYPE =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

/** ERC-2612. */
export const PERMIT_TYPE = "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)";

/** PolarisSend: the link's throwaway key opens the link, committing to the sender and amount. */
export const OPEN_TYPE = "Open(address sender,uint256 amount,uint64 expiresAt)";

/** PolarisSend: the link's throwaway key names who receives the money, briefly. */
export const CLAIM_TYPE = "Claim(address to,uint256 deadline)";

/** PolarisSend: the sender takes an unclaimed link back. */
export const CANCEL_TYPE = "Cancel(address linkKey,uint256 deadline)";

/** PolarisPayments: the subscriber leaves without holding gas. */
export const CANCEL_SUBSCRIPTION_TYPE = "CancelSubscription(uint256 subId,uint256 deadline)";

/** PolarisLoanEngine: pay a plan early. `expectedRepaid` pins the plan's state; `nonce` is PolarisLoanEngine.nonces(borrower). */
export const REPAY_INTENT_TYPE = "RepayIntent(uint256 loanId,uint256 amount,uint256 expectedRepaid,uint256 nonce,uint256 deadline)";

const AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

export const planIntentTypes = {
  PlanIntent: [
    { name: "buyer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "principal", type: "uint256" },
    { name: "installments", type: "uint32" },
    { name: "interval", type: "uint64" },
    { name: "orderId", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const subscribeIntentTypes = {
  SubscribeIntent: [
    { name: "buyer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "planId", type: "uint256" },
    { name: "pricePerPeriod", type: "uint256" },
    { name: "periodSeconds", type: "uint64" },
    { name: "orderId", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: AUTHORIZATION_FIELDS,
} as const;

export const transferWithAuthorizationTypes = {
  TransferWithAuthorization: AUTHORIZATION_FIELDS,
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const openTypes = {
  Open: [
    { name: "sender", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export const claimTypes = {
  Claim: [
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const cancelTypes = {
  Cancel: [
    { name: "linkKey", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const cancelSubscriptionTypes = {
  CancelSubscription: [
    { name: "subId", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const repayIntentTypes = {
  RepayIntent: [
    { name: "loanId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "expectedRepaid", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Every struct with the typehash preimage the contract declares for it. */
export const TYPE_REGISTRY = [
  { primaryType: "PlanIntent", types: planIntentTypes, solidity: PLAN_INTENT_TYPE },
  { primaryType: "SubscribeIntent", types: subscribeIntentTypes, solidity: SUBSCRIBE_INTENT_TYPE },
  {
    primaryType: "ReceiveWithAuthorization",
    types: receiveWithAuthorizationTypes,
    solidity: RECEIVE_WITH_AUTHORIZATION_TYPE,
  },
  {
    primaryType: "TransferWithAuthorization",
    types: transferWithAuthorizationTypes,
    solidity: TRANSFER_WITH_AUTHORIZATION_TYPE,
  },
  { primaryType: "Permit", types: permitTypes, solidity: PERMIT_TYPE },
  { primaryType: "Open", types: openTypes, solidity: OPEN_TYPE },
  { primaryType: "Claim", types: claimTypes, solidity: CLAIM_TYPE },
  { primaryType: "Cancel", types: cancelTypes, solidity: CANCEL_TYPE },
  { primaryType: "CancelSubscription", types: cancelSubscriptionTypes, solidity: CANCEL_SUBSCRIPTION_TYPE },
  { primaryType: "RepayIntent", types: repayIntentTypes, solidity: REPAY_INTENT_TYPE },
] as const;
