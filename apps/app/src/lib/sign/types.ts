/**
 * EIP-712 struct definitions, field for field with the contracts.
 *
 * Each `*_TYPE` string is the exact preimage of the contract's typehash
 * (`keccak256("PlanIntent(address buyer,...)")`). `scripts/verify-signatures.ts`
 * reads the typehash strings out of the Solidity sources themselves, checks
 * each one against the string here and the field list below, and checks the
 * digest viem signs equals the one the contract computes, so the two cannot
 * drift silently.
 *
 * Field order matters: EIP-712 hashes fields in declaration order.
 */

/** PolarisCheckout: open a Pay in 4 plan. `nonce` is `PolarisCheckout.nonces(buyer)`. */
export const PLAN_INTENT_TYPE =
  "PlanIntent(address buyer,address merchant,uint256 principal,uint32 installments,uint64 interval,string orderId,uint256 nonce,uint256 deadline)";

/** PolarisCheckout: start a subscription. Shares the buyer's nonce with PlanIntent. */
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

/** PolarisSend: the link's throwaway key names who receives the money, until a deadline. */
export const CLAIM_TYPE = "Claim(address to,uint256 deadline)";

/** PolarisSend: the sender takes an unclaimed link back. */
export const CANCEL_TYPE = "Cancel(address linkKey,uint256 deadline)";

/** PolarisPayments: the subscriber leaves without holding gas. */
export const CANCEL_SUBSCRIPTION_TYPE = "CancelSubscription(uint256 subId,uint256 deadline)";

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

/**
 * Every struct with the typehash preimage the app believes the contract
 * declares, and where the contract declares it (`contract`: the Solidity
 * file under packages/contracts/contracts, `constant`: the typehash constant),
 * so the check can read the real one.
 */
export const TYPE_REGISTRY = [
  {
    primaryType: "PlanIntent",
    types: planIntentTypes,
    solidity: PLAN_INTENT_TYPE,
    contract: "PolarisCheckout.sol",
    constant: "PLAN_INTENT_TYPEHASH",
  },
  {
    primaryType: "SubscribeIntent",
    types: subscribeIntentTypes,
    solidity: SUBSCRIBE_INTENT_TYPE,
    contract: "PolarisCheckout.sol",
    constant: "SUBSCRIBE_INTENT_TYPEHASH",
  },
  {
    primaryType: "ReceiveWithAuthorization",
    types: receiveWithAuthorizationTypes,
    solidity: RECEIVE_WITH_AUTHORIZATION_TYPE,
    contract: "MockAUSD.sol",
    constant: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
  },
  {
    primaryType: "TransferWithAuthorization",
    types: transferWithAuthorizationTypes,
    solidity: TRANSFER_WITH_AUTHORIZATION_TYPE,
    contract: "MockAUSD.sol",
    constant: "TRANSFER_WITH_AUTHORIZATION_TYPEHASH",
  },
  // ERC-2612 comes from OpenZeppelin's ERC20Permit, which MockAUSD inherits.
  {
    primaryType: "Permit",
    types: permitTypes,
    solidity: PERMIT_TYPE,
    contract: "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol",
    constant: "PERMIT_TYPEHASH",
  },
  { primaryType: "Claim", types: claimTypes, solidity: CLAIM_TYPE, contract: "PolarisSend.sol", constant: "CLAIM_TYPEHASH" },
  { primaryType: "Cancel", types: cancelTypes, solidity: CANCEL_TYPE, contract: "PolarisSend.sol", constant: "CANCEL_TYPEHASH" },
  {
    primaryType: "CancelSubscription",
    types: cancelSubscriptionTypes,
    solidity: CANCEL_SUBSCRIPTION_TYPE,
    contract: "PolarisPayments.sol",
    constant: "CANCEL_SUBSCRIPTION_TYPEHASH",
  },
] as const;
