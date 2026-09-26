/**
 * Replay a real chain through the real handlers.
 *
 * test/fixtures/local-chain.json is recorded by scripts/record-fixture.mjs: a
 * local Hardhat chain running the deploy script, the contracts' end-to-end
 * flows and scripts/fixture-scenarios.cjs (a failed collection, a
 * liquidation with seized collateral, payouts, a quoted order, cancellations,
 * a batch). Its logs are replayed here at the configured addresses, and the
 * indexed state must equal what the contracts themselves report.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { WEBHOOK_KINDS } from "../src/lib/util.js";
import { A, CHAIN, SETTINGS, Sim } from "./sim.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Recorded = {
  contract: string;
  event: string;
  srcAddress: string;
  blockNumber: number;
  timestamp: number;
  logIndex: number;
  txHash: string;
  txFrom: string;
  txTo: string | null;
  params: Record<string, string | boolean>;
};
type Fixture = {
  contracts: Record<string, string>;
  events: Recorded[];
  expected: {
    loans: Record<string, { status: number; installmentsPaid: number; totalRepaid: string; outstanding: string }>;
    subscriptions: Record<string, { status: number; nextChargeAt: number; periodsCharged: number; missedCharges: number }>;
    buyers: Record<string, { score: number; declined: boolean; underwritten: boolean; creditLimit: string; activeDebt: string; collateral: string }>;
    merchants: Record<string, { balance: string; registered: boolean; active: boolean; payoutAddress: string; maxOrderValue: string }>;
    sends: Record<string, { open: boolean }>;
  };
};

const fixture = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "local-chain.json"), "utf8")) as Fixture;

/** The fixture's contract names as config.yaml knows them, with their ABI file. */
const RENAME: Record<string, { contract: string; abi: string; address: string }> = {
  ScoreManager: { contract: "ScoreManager", abi: "ScoreManager", address: A.ScoreManager },
  PolarisLoanEngine: { contract: "PolarisLoanEngine", abi: "PolarisLoanEngine", address: A.PolarisLoanEngine },
  PolarisPayments: { contract: "PolarisPayments", abi: "PolarisPayments", address: A.PolarisPayments },
  MerchantRegistry: { contract: "MerchantRegistry", abi: "MerchantRegistry", address: A.MerchantRegistry },
  CollateralVault: { contract: "CollateralVault", abi: "CollateralVault", address: A.CollateralVault },
  BatchSettlement: { contract: "BatchSettlement", abi: "BatchSettlement", address: A.BatchSettlement },
  PolarisSend: { contract: "PolarisSend", abi: "PolarisSend", address: A.PolarisSend },
  PolarisCheckout: { contract: "PolarisCheckout", abi: "PolarisCheckout", address: A.PolarisCheckout },
  CollectionsReceiver: { contract: "CollectionsReceiver", abi: "CollectionsReceiver", address: A.CollectionsReceiver },
  UnderwritingReceiver: { contract: "UnderwritingReceiver", abi: "UnderwritingReceiver", address: A.UnderwritingReceiver },
  MockKeystoneForwarder: { contract: "CreForwarder", abi: "MockKeystoneForwarder", address: SETTINGS.creForwarders[0]! },
  Stablecoin: { contract: "MerchantWallet", abi: "IAUSD", address: A.Stablecoin },
};

/** Local contract address -> configured address. */
const ADDRESS = new Map(Object.entries(fixture.contracts).map(([name, local]) => [local, RENAME[name]!.address]));
const mapAddress = (a: string) => ADDRESS.get(a) ?? a;

function paramTypes(abiName: string, event: string): Map<string, string> {
  const raw = JSON.parse(readFileSync(join(ROOT, "..", "contracts", "abi", `${abiName}.json`), "utf8"));
  const abi = (Array.isArray(raw) ? raw : raw.abi) as Array<{ type: string; name: string; inputs: Array<{ name: string; type: string }> }>;
  const e = abi.find((x) => x.type === "event" && x.name === event);
  if (!e) throw new Error(`${abiName}.${event} not in the ABI`);
  return new Map(e.inputs.map((i) => [i.name, i.type]));
}

/** Which (contract, event) pairs config.yaml indexes. */
const CONFIG = readFileSync(join(ROOT, "config.yaml"), "utf8");
function indexed(contract: string, event: string): boolean {
  const block = CONFIG.split("\n  - name: ").find((b) => b.startsWith(`${contract}\n`));
  return block !== undefined && block.includes(`"${event}(`);
}

/** When each merchant account was first registered as a MerchantWallet (mirrors src/handlers/merchantWallet.ts). */
const REGISTERS: Record<string, string> = {
  "MerchantRegistry.MerchantRegistered": "merchant",
  "PolarisPayments.PaymentMade": "merchant",
  "PolarisPayments.OrderQuoted": "merchant",
  "PolarisPayments.PlanCreated": "merchant",
  "PolarisLoanEngine.LoanCreated": "merchant",
};
const registeredAt = new Map<string, number>();
for (const e of fixture.events) {
  const key = REGISTERS[`${e.contract}.${e.event}`];
  if (!key) continue;
  const m = e.params[key] as string;
  if (!registeredAt.has(m)) registeredAt.set(m, e.blockNumber);
}
const isMerchantAt = (a: string, block: number) => (registeredAt.get(a) ?? Infinity) <= block;

function simulateItems(offset: number) {
  const items: Array<Record<string, unknown>> = [];
  for (const e of fixture.events) {
    const target = RENAME[e.contract];
    if (!target || !indexed(target.contract, e.event)) continue;
    // The source only delivers stablecoin transfers that touch a merchant account.
    if (target.contract === "MerchantWallet") {
      const { from, to } = e.params as { from: string; to: string };
      if (!isMerchantAt(from, e.blockNumber) && !isMerchantAt(to, e.blockNumber)) continue;
    }
    const types = paramTypes(target.abi, e.event);
    const params: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(e.params)) {
      const type = types.get(name)!;
      if (/^u?int\d+$/.test(type)) params[name] = BigInt(value as string);
      else if (type === "address") params[name] = mapAddress(value as string);
      else params[name] = value;
    }
    items.push({
      contract: target.contract,
      event: e.event,
      srcAddress: target.address,
      logIndex: e.logIndex,
      params,
      block: { number: e.blockNumber + offset, timestamp: e.timestamp },
      transaction: { hash: e.txHash, from: e.txFrom, to: e.txTo === null ? undefined : mapAddress(e.txTo) },
    });
  }
  return items;
}

describe("replaying a real local chain", () => {
  const sim = new Sim();
  const PLAN_STATUS = ["ACTIVE", "REPAID", "LIQUIDATED"];
  const SUB_STATUS = ["ACTIVE", "CANCELLED", "LAPSED"];

  beforeAll(async () => {
    const items = simulateItems(SETTINGS.startBlock);
    expect(items.length).toBeGreaterThan(100);
    await sim.indexer.process({ chains: { [CHAIN]: { simulate: items } } } as never);
  });

  it("agrees with PolarisLoanEngine on every plan", async () => {
    for (const [id, loan] of Object.entries(fixture.expected.loans)) {
      const plan = await sim.indexer.Plan.getOrThrow(id);
      expect(plan, `loan ${id}`).toMatchObject({
        status: PLAN_STATUS[loan.status],
        installmentsPaid: loan.installmentsPaid,
        totalRepaid: BigInt(loan.totalRepaid),
        outstanding: BigInt(loan.outstanding),
      });
      if (plan.status !== "ACTIVE") expect(plan.nextAttemptAt).toBeUndefined();
    }
  });

  it("agrees with PolarisPayments on every subscription", async () => {
    for (const [id, s] of Object.entries(fixture.expected.subscriptions)) {
      const sub = await sim.indexer.Subscription.getOrThrow(id);
      expect(sub, `subscription ${id}`).toMatchObject({ status: SUB_STATUS[s.status], periodsCharged: s.periodsCharged, missedCharges: s.missedCharges });
      if (sub.status === "ACTIVE") expect(sub.nextChargeAt).toBe(s.nextChargeAt);
    }
  });

  it("agrees with ScoreManager, the vault and the engine on every credit line", async () => {
    for (const [address, b] of Object.entries(fixture.expected.buyers)) {
      const buyer = await sim.indexer.Buyer.getOrThrow(address);
      expect(buyer, `buyer ${address}`).toMatchObject({
        score: b.score,
        declined: b.declined,
        underwritten: b.underwritten,
        creditLimit: BigInt(b.creditLimit),
        activeDebt: BigInt(b.activeDebt),
        collateral: BigInt(b.collateral),
      });
    }
  });

  it("agrees with the token and the registry on every merchant", async () => {
    for (const [address, m] of Object.entries(fixture.expected.merchants)) {
      const merchant = await sim.indexer.Merchant.getOrThrow(address);
      expect(merchant, `merchant ${address}`).toMatchObject({
        balance: BigInt(m.balance),
        registered: m.registered,
        active: m.active,
        payoutAddress: m.payoutAddress,
        maxOrderValue: BigInt(m.maxOrderValue),
      });
    }
  });

  it("agrees with PolarisSend on every link", async () => {
    for (const [key, s] of Object.entries(fixture.expected.sends)) {
      expect((await sim.indexer.Send.getOrThrow(key)).status === "OPEN", `link ${key}`).toBe(s.open);
    }
    const statuses = (await sim.indexer.Send.getAll()).map((s) => s.status).sort();
    expect(statuses).toEqual(["CANCELLED", "CLAIMED", "REFUNDED"]);
  });

  it("wrote every kind of webhook, each once per event that caused it", async () => {
    const activities = await sim.indexer.Activity.getAll();
    expect(new Set(activities.map((a) => a.kind))).toEqual(new Set(WEBHOOK_KINDS));
    const cursors = activities.map((a) => a.cursor);
    expect(new Set(cursors).size).toBe(cursors.length);
    const count = (event: string) => fixture.events.filter((e) => `${e.contract}.${e.event}` === event).length;
    const kind = (k: string) => activities.filter((a) => a.kind === k).length;
    expect(kind("payment.succeeded")).toBe(count("PolarisPayments.PaymentMade") + count("PolarisCheckout.PlanOpened") + count("PolarisCheckout.SubscriptionStarted"));
    expect(kind("subscription.charged")).toBe(count("PolarisPayments.SubscriptionCharged"));
    expect(kind("plan.liquidated")).toBe(count("PolarisLoanEngine.LoanLiquidated"));
  });

  it("explains every collection: executed, short on funds, or stale", async () => {
    const tasks = await sim.indexer.CollectionTask.getAll();
    expect(tasks.filter((t) => t.executed)).toHaveLength(3);
    const skipped = tasks.filter((t) => !t.executed).map((t) => [t.targetId, t.reason, t.reasonAction]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        [2n, "InsufficientBalance", "TOP_UP"],
        [1n, "LoanNotActive", "STALE"],
      ]),
    );
    expect((await sim.indexer.Installment.getOrThrow("2-0")).failedAttempts).toBe(1);
    const runs = await sim.indexer.CollectionRun.getAll();
    expect(runs).toHaveLength(4);
    const reports = await sim.indexer.CreReport.getAll();
    expect(reports.every((r) => r.result)).toBe(true);
    expect(reports.filter((r) => r.workflow === "collections")).toHaveLength(4);
  });

  it("recognises the gasless payouts, the quoted order and the refused underwriting", async () => {
    const payouts = await sim.indexer.Payout.getAll();
    expect(payouts).toHaveLength(2);
    expect(payouts.filter((p) => p.toPayoutAddress)).toHaveLength(1);
    const quoted = (await sim.indexer.Order.getAll()).filter((o) => o.quotedAmount !== undefined);
    expect(quoted).toHaveLength(1);
    expect(quoted[0]).toMatchObject({ status: "PAID", quoteMatched: true });
    const refused = (await sim.indexer.Underwriting.getAll()).filter((u) => !u.applied);
    expect(refused.map((u) => u.refusal)).toEqual(["AlreadyHasRecord"]);
    const withheld = (await sim.indexer.Repayment.getAll()).filter((r) => r.bonusWithheld);
    expect(withheld).toHaveLength(1);
  });

  it("keeps the protocol's totals equal to a recount of the rows", async () => {
    const p = await sim.indexer.Protocol.getOrThrow("polaris");
    const payments = await sim.indexer.Payment.getAll();
    expect(p.paymentCount).toBe(payments.length);
    expect(p.grossVolume).toBe(payments.reduce((s, x) => s + x.amount, 0n));
    const plans = await sim.indexer.Plan.getAll();
    expect(p.activePlanCount).toBe(plans.filter((x) => x.status === "ACTIVE").length);
    expect(p.outstanding).toBe(plans.filter((x) => x.status === "ACTIVE").reduce((s, x) => s + x.outstanding, 0n));
    const merchants = await sim.indexer.Merchant.getAll();
    expect(p.merchantCount).toBe(merchants.length);
    for (const m of merchants) {
      const mine = payments.filter((x) => x.merchant_id === m.id);
      expect(m.paymentCount, m.id).toBe(mine.length);
      expect(m.grossVolume, m.id).toBe(mine.reduce((s, x) => s + x.amount, 0n));
    }
    const subs = await sim.indexer.Subscription.getAll();
    expect(p.activeSubscriptionCount).toBe(subs.filter((s) => s.status === "ACTIVE").length);
  });
});
