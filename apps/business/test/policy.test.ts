import { encodeFunctionData, erc20Abi, getAddress, zeroHash, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { iausdAbi, merchantRegistryAbi, polarisCheckoutAbi, polarisLoanEngineAbi, polarisPaymentsAbi, polarisSendAbi } from "@polarispay/contracts/abi";
import { buildPayoutPolicy, TWA_TYPES } from "@/server/policy/payout";
import {
  buildRegistryAdminPolicy,
  buildRelayerPolicy,
  checkRelayerCall,
  lintPolicy,
  PolicyViolation,
  RELAYER_CALLS,
  type RelayerAddresses,
} from "@/server/policy/relayer";

const addresses: RelayerAddresses = {
  checkout: "0x000000000000000000000000000000000000C4c1",
  payments: "0x0000000000000000000000000000000000009A01",
  send: "0x0000000000000000000000000000000000005E01",
  loanEngine: "0x0000000000000000000000000000000000001E01",
  registry: "0x0000000000000000000000000000000000004E01",
  stablecoin: "0x00000000000000000000000000000000000A05D0",
};
for (const k of Object.keys(addresses) as (keyof RelayerAddresses)[]) addresses[k] = getAddress(addresses[k]);
const expected = { chainId: 10143, addresses };
const someone = "0x1111111111111111111111111111111111111111" as Address;
const merchant = "0x2222222222222222222222222222222222222222" as Address;

const payData = encodeFunctionData({
  abi: polarisCheckoutAbi,
  functionName: "pay",
  args: [someone, merchant, 25_000_000n, "order-1", 0n, 2_000_000_000n, 27, zeroHash, zeroHash],
});

describe("the relayer's allow-list (checkRelayerCall)", () => {
  it("allows every listed call, and nothing else on those contracts", () => {
    expect(checkRelayerCall({ to: addresses.checkout, data: payData, value: 0n, chainId: 10143 }, expected)).toMatchObject({ contract: "checkout", functionName: "pay" });
    const repay = encodeFunctionData({ abi: polarisLoanEngineAbi, functionName: "repayWithSig", args: [1n, 1n, 0n, 2n, "0x"] });
    expect(checkRelayerCall({ to: addresses.loanEngine, data: repay, chainId: 10143 }, expected).functionName).toBe("repayWithSig");
    const claim = encodeFunctionData({ abi: polarisSendAbi, functionName: "claim", args: [someone, merchant, 1n, 27, zeroHash, zeroHash] });
    expect(checkRelayerCall({ to: addresses.send, data: claim, chainId: 10143 }, expected).functionName).toBe("claim");
    const twa = encodeFunctionData({ abi: iausdAbi, functionName: "transferWithAuthorization", args: [someone, merchant, 1n, 0n, 1n, zeroHash, 27, zeroHash, zeroHash] });
    expect(checkRelayerCall({ to: addresses.stablecoin, data: twa, chainId: 10143 }, expected).functionName).toBe("transferWithAuthorization");
  });

  it("allows a buyer's re-signed permit through PolarisCheckout.reauthorize, but never a bare AUSD permit", () => {
    const permit = { value: 201_530_000n, deadline: 2_000_000_000n, v: 27, r: zeroHash, s: zeroHash };
    const reauthorize = encodeFunctionData({ abi: polarisCheckoutAbi, functionName: "reauthorize", args: [someone, permit] });
    expect(checkRelayerCall({ to: addresses.checkout, data: reauthorize, chainId: 10143 }, expected)).toMatchObject({ contract: "checkout", functionName: "reauthorize" });
    expect(buildRelayerPolicy(expected).rules.some((r) => r.name === "Re-sign: PolarisCheckout.reauthorize")).toBe(true);
    const bare = encodeFunctionData({ abi: iausdAbi, functionName: "permit", args: [someone, merchant, 1n, 2n, 27, zeroHash, zeroHash] });
    expect(() => checkRelayerCall({ to: addresses.stablecoin, data: bare, chainId: 10143 }, expected)).toThrow(/allow-list/);
  });

  it("refuses a relayer that tries to send MON", () => {
    expect(() => checkRelayerCall({ to: addresses.checkout, data: payData, value: 1n, chainId: 10143 }, expected)).toThrow(PolicyViolation);
  });

  it("refuses another chain", () => {
    expect(() => checkRelayerCall({ to: addresses.checkout, data: payData, chainId: 143 }, expected)).toThrow(/only on chain 10143/);
  });

  it("refuses a contract that isn't ours, even with a listed function", () => {
    expect(() => checkRelayerCall({ to: someone, data: payData, chainId: 10143 }, expected)).toThrow(/isn't a Polaris contract/);
  });

  it("refuses approve on the dollar token (a relayer must never set allowances)", () => {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [someone, 2n ** 255n] });
    expect(() => checkRelayerCall({ to: addresses.stablecoin, data: approve, chainId: 10143 }, expected)).toThrow(/allow-list/);
  });

  it("refuses owner functions on our own contracts", () => {
    const setOperator = encodeFunctionData({ abi: polarisPaymentsAbi, functionName: "setOperator", args: [someone, true] });
    expect(() => checkRelayerCall({ to: addresses.payments, data: setOperator, chainId: 10143 }, expected)).toThrow(/allow-list/);
    const activate = encodeFunctionData({ abi: merchantRegistryAbi, functionName: "setActive", args: [someone, true] });
    expect(() => checkRelayerCall({ to: addresses.registry, data: activate, chainId: 10143 }, expected)).toThrow(/allow-list/);
    const withdraw = encodeFunctionData({ abi: polarisLoanEngineAbi, functionName: "withdrawLiquidity", args: [1n, someone] });
    expect(() => checkRelayerCall({ to: addresses.loanEngine, data: withdraw, chainId: 10143 }, expected)).toThrow(/allow-list/);
  });

  it("refuses a plain transfer and a deployment", () => {
    expect(() => checkRelayerCall({ to: someone, data: "0x", chainId: 10143 }, expected)).toThrow(PolicyViolation);
    expect(() => checkRelayerCall({ to: null, data: payData, chainId: 10143 }, expected)).toThrow(/deploys/);
    expect(() => checkRelayerCall({ to: addresses.checkout, data: "0x", chainId: 10143 }, expected)).toThrow(/functions/);
  });
});

describe("the Privy relayer policy (buildRelayerPolicy)", () => {
  const policy = buildRelayerPolicy(expected);

  it("passes Privy's own limits", () => {
    expect(lintPolicy(policy)).toEqual([]);
    expect(policy).toMatchObject({ version: "1.0", chain_type: "ethereum" });
  });

  it("denies any MON first, then allows exactly one rule per listed call", () => {
    const [deny, ...allows] = policy.rules;
    expect(deny).toMatchObject({ action: "DENY", method: "eth_signTransaction", conditions: [{ field: "value", operator: "gt", value: "0" }] });
    expect(allows).toHaveLength(RELAYER_CALLS.length);
    for (const rule of allows) expect(rule).toMatchObject({ action: "ALLOW", method: "eth_signTransaction" });
  });

  it("pins each rule to our chain, our contract (either spelling) and one function, with function-only ABI fragments", () => {
    for (const [i, call] of RELAYER_CALLS.entries()) {
      const rule = policy.rules[i + 1];
      const [to, chain, fn] = rule?.conditions ?? [];
      expect(to).toEqual({ field_source: "ethereum_transaction", field: "to", operator: "in", value: [addresses[call.contract], addresses[call.contract].toLowerCase()] });
      expect(chain).toEqual({ field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" });
      expect(fn).toMatchObject({ field_source: "ethereum_calldata", field: "function_name", operator: "eq", value: call.functionName });
      const abi = (fn as { abi: Array<{ type: string; name: string }> }).abi;
      expect(abi.length).toBeGreaterThan(0);
      expect(abi.every((x) => x.type === "function" && x.name === call.functionName)).toBe(true);
    }
  });

  it("never allows a raw MON transfer, approve, typed data or key export (no rule for them)", () => {
    const methods = new Set(policy.rules.map((r) => r.method));
    expect([...methods]).toEqual(["eth_signTransaction"]);
    const allowedFns = policy.rules.flatMap((r) => r.conditions.filter((c) => c.field === "function_name").map((c) => c.value));
    expect(allowedFns).not.toContain("approve");
    expect(allowedFns).not.toContain("transfer");
  });
});

describe("the registry admin policy", () => {
  it("allows only setActive and setMaxOrderValue up to the cap", () => {
    const policy = buildRegistryAdminPolicy({ chainId: 10143, registry: addresses.registry, capUnits: 1_000_000_000n });
    expect(lintPolicy(policy)).toEqual([]);
    const allowed = policy.rules.filter((r) => r.action === "ALLOW");
    expect(allowed.map((r) => r.conditions.find((c) => c.field === "function_name")?.value)).toEqual(["setActive", "setMaxOrderValue"]);
    expect(allowed[1]?.conditions).toContainEqual(expect.objectContaining({ field: "setMaxOrderValue.maxOrderValue", operator: "lte", value: "1000000000" }));
  });
});

describe("the automatic payout policy", () => {
  it("pins typed-data signing to AUSD, this chain, the merchant's own wallet and one payout address", () => {
    const payout = "0x3333333333333333333333333333333333333333" as Address;
    const policy = buildPayoutPolicy({ merchantKey: "did:privy:abc", payoutAddress: payout, stablecoin: addresses.stablecoin, chainId: 10143 });
    expect(lintPolicy(policy)).toEqual([]);
    expect(policy.name).toBe("payout-abc");
    expect(policy.rules).toHaveLength(1);
    const [rule] = policy.rules;
    expect(rule).toMatchObject({ method: "eth_signTypedData_v4", action: "ALLOW" });
    const conds = rule?.conditions ?? [];
    expect(conds).toContainEqual({ field_source: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: "10143" });
    expect(conds).toContainEqual({ field_source: "ethereum_typed_data_domain", field: "verifyingContract", operator: "in", value: [addresses.stablecoin, addresses.stablecoin.toLowerCase()] });
    expect(conds).toContainEqual(expect.objectContaining({ field: "to", operator: "in", value: [payout, payout.toLowerCase()] }));
    expect(conds).toContainEqual(expect.objectContaining({ field: "from", operator: "eq", value: "{{wallet.address}}" }));
    expect(conds).toContainEqual(expect.objectContaining({ field: "value", operator: "lte" }));
    // The typed-data conditions only evaluate when the request's types match these exactly.
    for (const c of conds.filter((x) => x.field_source === "ethereum_typed_data_message")) {
      expect((c.typed_data as { types: unknown }).types).toEqual(TWA_TYPES);
    }
  });
});
