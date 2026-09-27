/**
 * The relayer's allow-list, in one place, for two enforcers:
 *
 *   1. Privy. `buildRelayerPolicy` turns it into the policy attached to the
 *      relayer's server wallet (scripts/privy/setup-relayer.mjs). Privy's
 *      policy engine runs in its enclave and denies anything no rule allows,
 *      so a compromised server still can't sign a call off this list.
 *   2. Us. `checkRelayerCall` applies the same list before a request ever
 *      reaches Privy (or, in local development, a raw key), so a call the
 *      policy would deny fails here with a clear error, and the dev adapter
 *      is held to exactly the production policy.
 *
 * Every call on the list carries its owner's own signature (the buyer's
 * ERC-3009 authorisation or EIP-712 intent, the link key's claim, the
 * merchant's registration or transfer), so the relayer can carry money but
 * can't choose where it goes. And it never sends MON: every rule requires a
 * zero value, and a DENY rule refuses any value at all.
 *
 * This module is plain, erasable TypeScript with no server-only imports, so
 * the setup scripts load it directly with Node's type stripping.
 */

import { decodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import {
  iausdAbi,
  merchantRegistryAbi,
  polarisCheckoutAbi,
  polarisLoanEngineAbi,
  polarisPaymentsAbi,
  polarisSendAbi,
} from "@polarispay/contracts/abi";

export type RelayerContract = "checkout" | "payments" | "send" | "loanEngine" | "registry" | "stablecoin";

export type AllowedCall = {
  contract: RelayerContract;
  functionName: string;
  /** Privy rule name: 50 characters at most. */
  rule: string;
  /** What it's for, in the docs and the policy proof. */
  why: string;
};

export const RELAYER_CALLS: readonly AllowedCall[] = [
  { contract: "checkout", functionName: "pay", rule: "Pay now: PolarisCheckout.pay", why: "Buyer's ERC-3009 ReceiveWithAuthorization, nonce = order key" },
  { contract: "checkout", functionName: "openPlan", rule: "Pay in 4: PolarisCheckout.openPlan", why: "Buyer's PlanIntent + ERC-2612 permit" },
  { contract: "checkout", functionName: "subscribe", rule: "Subscribe: PolarisCheckout.subscribe", why: "Buyer's SubscribeIntent + ERC-2612 permit" },
  { contract: "payments", functionName: "payWithAuthorization", rule: "Direct pay: PolarisPayments.payWithAuthorization", why: "polarispay-sdk pay(): buyer's ERC-3009 authorisation" },
  { contract: "payments", functionName: "cancelWithSignature", rule: "Cancel subscription: cancelWithSignature", why: "Subscriber's CancelSubscription signature" },
  { contract: "payments", functionName: "createPlanFor", rule: "Publish plan: PolarisPayments.createPlanFor", why: "A merchant's subscription terms from a checkout session" },
  { contract: "send", functionName: "send", rule: "Send by link: PolarisSend.send", why: "Sender's ERC-3009 authorisation + the link key's Open" },
  { contract: "send", functionName: "claim", rule: "Claim a link: PolarisSend.claim", why: "The link key's Claim naming the recipient" },
  { contract: "send", functionName: "cancel", rule: "Cancel a link: PolarisSend.cancel", why: "Sender's Cancel signature" },
  { contract: "loanEngine", functionName: "repayWithSig", rule: "Pay early: PolarisLoanEngine.repayWithSig", why: "Borrower's RepayIntent" },
  { contract: "registry", functionName: "registerFor", rule: "Onboard: MerchantRegistry.registerFor", why: "Merchant's Registration signature (Privy embedded wallet)" },
  { contract: "registry", functionName: "updatePayoutAddressWithSig", rule: "Payout address: updatePayoutAddressWithSig", why: "Merchant's PayoutUpdate signature" },
  { contract: "stablecoin", functionName: "transferWithAuthorization", rule: "Payouts: AUSD transferWithAuthorization", why: "Owner's ERC-3009 TransferWithAuthorization (withdrawals, payouts, sends to a user)" },
];

export const CONTRACT_ABIS: Record<RelayerContract, Abi> = {
  checkout: polarisCheckoutAbi as unknown as Abi,
  payments: polarisPaymentsAbi as unknown as Abi,
  send: polarisSendAbi as unknown as Abi,
  loanEngine: polarisLoanEngineAbi as unknown as Abi,
  registry: merchantRegistryAbi as unknown as Abi,
  stablecoin: iausdAbi as unknown as Abi,
};

export type RelayerAddresses = Record<RelayerContract, Address>;

export class PolicyViolation extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = "PolicyViolation";
    this.rule = rule;
  }
}

export type CheckedCall = { contract: RelayerContract; functionName: string; args: readonly unknown[] };

/**
 * Refuse any transaction the relayer policy wouldn't allow: another chain,
 * any MON, a contract off the list, or a function off the list.
 */
export function checkRelayerCall(
  tx: { to: Address | null | undefined; data: Hex | undefined; value?: bigint; chainId: number },
  expected: { chainId: number; addresses: RelayerAddresses },
): CheckedCall {
  if (tx.chainId !== expected.chainId) {
    throw new PolicyViolation("chain_id", `The relayer signs only on chain ${expected.chainId}, not ${tx.chainId}.`);
  }
  if (tx.value !== undefined && tx.value !== 0n) {
    throw new PolicyViolation("Never send MON", "The relayer never sends MON.");
  }
  if (!tx.to) throw new PolicyViolation("to", "The relayer never deploys contracts.");
  const to = getAddress(tx.to);
  const contract = (Object.keys(expected.addresses) as RelayerContract[]).find((c) => getAddress(expected.addresses[c]) === to);
  if (!contract) throw new PolicyViolation("to", `${to} isn't a Polaris contract the relayer may call.`);
  if (!tx.data || tx.data.length < 10) throw new PolicyViolation("function_name", "The relayer only calls contract functions.");

  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: CONTRACT_ABIS[contract], data: tx.data }) as { functionName: string; args?: readonly unknown[] };
  } catch {
    throw new PolicyViolation("function_name", `That isn't a function of ${contract}.`);
  }
  const allowed = RELAYER_CALLS.find((c) => c.contract === contract && c.functionName === decoded.functionName);
  if (!allowed) {
    throw new PolicyViolation("function_name", `${contract}.${decoded.functionName} isn't on the relayer's allow-list.`);
  }
  return { contract, functionName: decoded.functionName, args: decoded.args ?? [] };
}

/* ── The Privy policy ───────────────────────────────────────────────────── */

type Condition = Record<string, unknown>;
export type PrivyRule = { name: string; method: string; action: "ALLOW" | "DENY"; conditions: Condition[] };
export type PrivyPolicy = { version: "1.0"; name: string; chain_type: "ethereum"; rules: PrivyRule[] };

/** Addresses are compared as strings: accept both spellings. */
export const bothCases = (a: string): string[] => [getAddress(a), a.toLowerCase()];

/** Only the function fragments named `name`: Privy's ABI items can't be errors. */
export function functionFragments(abi: Abi, name: string): Abi {
  return abi.filter((item) => item.type === "function" && item.name === name) as Abi;
}

/**
 * The relayer's Privy policy (docs/research/privy.md §5.5).
 *
 * - `eth_signTransaction`: Privy signs, we broadcast to our own Monad RPC
 *   with the gas limit set from estimateGas + 15% (Monad bills the limit).
 * - One DENY rule refuses any transaction carrying MON. The Node SDK's viem
 *   adapter omits a zero `value`, so "value = 0" can't be an ALLOW condition.
 * - One ALLOW rule per call: this chain, this contract, this function.
 * - Everything else (other contracts, `approve`, raw MON transfers,
 *   `personal_sign`, typed data, key export) matches no rule and is denied.
 */
export function buildRelayerPolicy(input: { chainId: number; addresses: RelayerAddresses; name?: string }): PrivyPolicy {
  const onChain: Condition = { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(input.chainId) };
  const rules: PrivyRule[] = [
    {
      name: "Never send MON",
      method: "eth_signTransaction",
      action: "DENY",
      conditions: [{ field_source: "ethereum_transaction", field: "value", operator: "gt", value: "0" }],
    },
  ];
  for (const call of RELAYER_CALLS) {
    rules.push({
      name: call.rule,
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "to", operator: "in", value: bothCases(input.addresses[call.contract]) },
        onChain,
        {
          field_source: "ethereum_calldata",
          field: "function_name",
          abi: functionFragments(CONTRACT_ABIS[call.contract], call.functionName),
          operator: "eq",
          value: call.functionName,
        },
      ],
    });
  }
  return { version: "1.0", name: (input.name ?? `polaris-relayer-${input.chainId}`).slice(0, 50), chain_type: "ethereum", rules };
}

/**
 * The registry admin's policy: it owns MerchantRegistry so it can activate
 * merchants, and it may do exactly that: `setActive`, and `setMaxOrderValue`
 * up to the activation cap. Nothing else a registry owner could do
 * (operators, ownership, settlements) is signable.
 */
export function buildRegistryAdminPolicy(input: { chainId: number; registry: Address; capUnits: bigint; name?: string }): PrivyPolicy {
  const registryAbi = CONTRACT_ABIS.registry;
  const base = (fn: string): Condition[] => [
    { field_source: "ethereum_transaction", field: "to", operator: "in", value: bothCases(input.registry) },
    { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(input.chainId) },
    { field_source: "ethereum_calldata", field: "function_name", abi: functionFragments(registryAbi, fn), operator: "eq", value: fn },
  ];
  return {
    version: "1.0",
    name: (input.name ?? `polaris-registry-admin-${input.chainId}`).slice(0, 50),
    chain_type: "ethereum",
    rules: [
      {
        name: "Never send MON",
        method: "eth_signTransaction",
        action: "DENY",
        conditions: [{ field_source: "ethereum_transaction", field: "value", operator: "gt", value: "0" }],
      },
      { name: "Activate a merchant: setActive", method: "eth_signTransaction", action: "ALLOW", conditions: base("setActive") },
      {
        name: "Cap a merchant: setMaxOrderValue within cap",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          ...base("setMaxOrderValue"),
          {
            field_source: "ethereum_calldata",
            field: "setMaxOrderValue.maxOrderValue",
            abi: functionFragments(registryAbi, "setMaxOrderValue"),
            operator: "lte",
            value: input.capUnits.toString(),
          },
        ],
      },
    ],
  };
}

/** Check a policy's own constraints (names ≤ 50 chars, function-only ABIs). */
export function lintPolicy(policy: PrivyPolicy): string[] {
  const problems: string[] = [];
  if (policy.name.length > 50) problems.push(`policy name is ${policy.name.length} characters (max 50)`);
  for (const rule of policy.rules) {
    if (rule.name.length > 50) problems.push(`rule "${rule.name}" is ${rule.name.length} characters (max 50)`);
    for (const c of rule.conditions) {
      const abi = c.abi as Array<{ type: string }> | undefined;
      if (abi && abi.some((item) => item.type !== "function")) problems.push(`rule "${rule.name}" has a non-function ABI item`);
      if (abi && abi.length === 0) problems.push(`rule "${rule.name}" has an empty ABI`);
    }
  }
  return problems;
}
