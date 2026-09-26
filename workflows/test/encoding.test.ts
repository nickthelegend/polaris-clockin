/**
 * The report bytes, held to the contracts' own encoders and ABIs.
 *
 * packages/contracts/lib/cre.js is what the Hardhat suite drives both
 * receivers with, so byte-identical output here means the receivers decode
 * the workflows' reports exactly as they decode the suite's. The on-chain
 * round trip is in test/e2e (a local node, through the mock forwarder).
 */

import { describe, expect, test } from "bun:test";
import { collectionsReceiverAbi } from "@polarispay/contracts/abi";
import { encodeFunctionData, type Hex, zeroAddress } from "viem";
import { Report } from "@chainlink/cre-sdk";
import { concatHex, hexToBytes, padHex } from "viem";
import { gasLimitFor, splitReport, workflowNameBytes10 } from "../src/shared/evm.ts";
import {
  ACTION,
  chainWindow,
  chunk,
  decodeCollectionsReport,
  encodeCollectionsReport,
  MAX_CHECK_BATCH,
  planTasks,
  type Task,
} from "../src/collections/tasks.ts";
import { decodeUnderwritingReport, encodeUnderwritingReport } from "../src/underwriting/report.ts";
import { requireModule } from "./helpers/host.ts";

const creLib = requireModule("@polarispay/contracts/lib/cre") as {
  encodeCollectionsReport(tasks: Array<{ action: number; id: bigint }>): string;
  encodeUnderwritingReport(items: unknown[]): string;
  workflowNameBytes10(name: string): string;
  WORKFLOW_NAMES: { COLLECTIONS: string; UNDERWRITING: string };
};

const FACTS = {
  walletAgeDays: 1186,
  txCount: 902,
  stableBalance: 4_237_120_000n,
  defiTenureDays: 730,
  priorLiquidations: 0,
  relatedWallets: 0,
  exchangeFunded: true,
  observedAt: 1_790_424_000n,
};

describe("collections report", () => {
  const tasks: Task[] = [
    { action: ACTION.COLLECT_INSTALLMENT, id: 1n },
    { action: ACTION.LIQUIDATE, id: 1n },
    { action: ACTION.CHARGE_SUBSCRIPTION, id: 2n ** 200n },
  ];

  test("is byte-identical to packages/contracts/lib/cre.js", () => {
    expect(encodeCollectionsReport(tasks)).toBe(creLib.encodeCollectionsReport(tasks) as Hex);
    expect(encodeCollectionsReport([])).toBe(creLib.encodeCollectionsReport([]) as Hex);
  });

  test("round-trips", () => {
    expect(decodeCollectionsReport(encodeCollectionsReport(tasks))).toEqual({ kind: 1, tasks });
  });

  test("a full checkTasks batch fits CRE's 5 KB read request", () => {
    const batch = Array.from({ length: MAX_CHECK_BATCH }, (_, i) => ({ action: 1, id: 2n ** 255n + BigInt(i) }));
    const data = encodeFunctionData({ abi: collectionsReceiverAbi, functionName: "checkTasks", args: [batch] });
    expect((data.length - 2) / 2).toBeLessThanOrEqual(5 * 1024 - 400);
  });
});

describe("underwriting report", () => {
  test("is byte-identical to packages/contracts/lib/cre.js, with and without a linked wallet", () => {
    const items = [
      { user: "0x00000000000000000000000000000000000000b1", linkedWallet: "0x00000000000000000000000000000000000000b2", facts: FACTS },
      { user: "0x00000000000000000000000000000000000000b3", linkedWallet: null, facts: { ...FACTS, exchangeFunded: false } },
    ] as const;
    const ours = encodeUnderwritingReport(items.map((i) => ({ ...i, user: i.user as Hex, linkedWallet: i.linkedWallet as Hex | null })));
    const theirs = creLib.encodeUnderwritingReport(items.map((i) => ({ ...i, linkedWallet: i.linkedWallet ?? undefined })));
    expect(ours).toBe(theirs as Hex);
    const back = decodeUnderwritingReport(ours);
    expect(back.kind).toBe(2);
    expect(back.items[1]!.linkedWallet).toBeNull();
    expect(back.items[0]!.facts).toEqual(FACTS);
  });

  test("refuses facts that do not fit their uint width instead of truncating", () => {
    expect(() =>
      encodeUnderwritingReport([{ user: zeroAddress, linkedWallet: null, facts: { ...FACTS, relatedWallets: 70_000 } }]),
    ).toThrow(/does not fit uint16/);
  });
});

describe("workflow identity and gas", () => {
  test("workflow names hash as the receivers expect", () => {
    expect(workflowNameBytes10("polaris-collections")).toBe("0x38323961376630323863");
    expect(workflowNameBytes10("polaris-underwrite")).toBe("0x39333731613831386437");
    expect(workflowNameBytes10("my_workflow")).toBe("0x62373666336165316465"); // the CRE docs' example
    for (const n of Object.values(creLib.WORKFLOW_NAMES)) expect(workflowNameBytes10(n)).toBe(creLib.workflowNameBytes10(n) as Hex);
  });

  test("a signed report splits as the forwarder splits it: metadata [45, 109), body [109, end)", () => {
    const metadata = concatHex([padHex("0x01", { size: 32 }), workflowNameBytes10("polaris-collections"), padHex("0xaa", { size: 20 }), "0x0001"]);
    const body = encodeCollectionsReport([{ action: ACTION.COLLECT_INSTALLMENT, id: 7n }]);
    const raw = concatHex([padHex("0x01", { size: 45 }), metadata, body]);
    const report = new Report({ rawReport: hexToBytes(raw) } as never);
    expect(splitReport(report)).toEqual({ metadata, body });
  });

  test("the gas limit: estimate (+ overhead when it covered onReport alone) + headroom, clamped", () => {
    const gas = { overhead: "80000", headroomBps: 1500, min: "200000", max: "1000000" };
    expect(gasLimitFor(400_000n, gas)).toBe(552_000n);
    expect(gasLimitFor(400_000n, gas, "delivery")).toBe(460_000n);
    expect(gasLimitFor(1n, gas)).toBe(200_000n);
    expect(gasLimitFor(5_000_000n, gas)).toBe(1_000_000n);
  });
});

describe("candidate windows and batching", () => {
  test("the newest ids every run, and a sweep that reaches every older id on a real cron's ticks", () => {
    // Every minute at second 0, and daily: ticks that are multiples of 60 and
    // 86,400, which a sweep stepping by the tick would never rotate through.
    for (const period of [60n, 86_400n]) {
      const seen = new Set<bigint>();
      for (let run = 0n; run < 40n; run++) {
        const w = chainWindow(120n, 10, 20, 1_790_000_000n - (1_790_000_000n % period) + run * period);
        for (let id = 111n; id <= 120n; id++) expect(w).toContain(id);
        expect(w.length).toBeLessThanOrEqual(30);
        for (const id of w) seen.add(id);
      }
      expect(seen.size).toBe(120);
    }
  });

  test("small and empty counts", () => {
    expect(chainWindow(0n, 10, 10, 5n)).toEqual([]);
    expect(chainWindow(3n, 10, 10, 5n)).toEqual([1n, 2n, 3n]);
  });

  test("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunk([1], 0)).toThrow();
  });

  test("planTasks orders and caps without splitting a loan's pair", () => {
    const tasks = planTasks({ collect: [5n, 2n], charge: [9n, 1n], liquidate: [5n] }, 4);
    expect(tasks).toEqual([
      { action: ACTION.COLLECT_INSTALLMENT, id: 2n },
      { action: ACTION.COLLECT_INSTALLMENT, id: 5n },
      { action: ACTION.LIQUIDATE, id: 5n },
      { action: ACTION.CHARGE_SUBSCRIPTION, id: 1n },
    ]);
  });
});
