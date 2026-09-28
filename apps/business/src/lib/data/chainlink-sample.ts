import type { ChainlinkOverview, ChainlinkRun, ChainlinkWorkflow } from "./chainlink";
import { describeCron, nextCronFire } from "./cron";
import { guardChecks, type CreditGuard } from "./guard";

/**
 * The Chainlink page's sample, for a server with nothing deployed (and the
 * development mock session): the same shapes the API serves, invented and
 * marked `sample`, so every card carries the Sample chip and no made-up hash
 * links to an explorer. Deterministic for a given minute, so a screenshot
 * is stable.
 */

const MINUTE = 60_000;

function sampleHash(seed: string): `0x${string}` {
  // FNV-1a over the whole seed first, so seeds that share a first letter don't share a prefix.
  let h = 2166136261;
  for (const c of `polaris sample ${seed}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; out.length < 64; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, 64)}`;
}

const iso = (t: number) => new Date(t).toISOString();

export function placeholderGuard(now = Date.now()): CreditGuard {
  const observed = Math.floor(now / 1000) - 7 * 60;
  const attestation = {
    price: 99_980_000n,
    priceUpdatedAt: BigInt(observed - 38 * 60),
    freeCash: 48_210_360_000n,
    badDebt: 0n,
    totalOriginated: 12_480_000_000n,
    observedAt: BigInt(observed),
  };
  const thresholds = { minPrice: 99_500_000n, maxPrice: 100_500_000n, minFreeCash: 1_000_000_000n, maxBadDebtBps: 500, minOriginated: 10_000_000_000n, maxPriceAge: 7200 };
  const pool = { freeCash: 48_210_360_000n, badDebt: 0n, totalOriginated: 12_480_000_000n };
  return {
    state: "open",
    paused: false,
    reasons: [],
    message: null,
    checkedAt: iso(observed * 1000),
    ageSeconds: 7 * 60,
    maxAgeSeconds: 3600,
    override: "none",
    overrideUntil: null,
    guardian: null,
    mismatch: null,
    round: 214,
    readAt: iso(now),
    attested: { paused: false, reasons: [] },
    sources: { pool: [], price: [] },
    thresholds: { minPrice: "0.995", maxPrice: "1.005", minFreeCashUnits: "1000000000", maxBadDebtBps: 500, minOriginatedUnits: "10000000000", maxPriceAgeSeconds: 7200 },
    pool: { freeCashUnits: "48210360000", totalOwedUnits: "5335610000", badDebtUnits: "0", totalOriginatedUnits: "12480000000", badDebtAcknowledgedUnits: "0" },
    attestation: {
      priceRoundId: "18446744073709552612",
      price: "0.9998",
      priceUpdatedAt: iso((observed - 38 * 60) * 1000),
      freeCashUnits: "48210360000",
      totalOwedUnits: "5335610000",
      badDebtUnits: "0",
      totalOriginatedUnits: "12480000000",
      observedAt: iso(observed * 1000),
    },
    checks: guardChecks(attestation, pool, thresholds),
    feed: {
      address: "0x0000000000000000000000000000000000000000",
      description: "Polaris pool health, computed by CRE",
      decimals: 8,
      roundId: "214",
      answer: "4820071800000",
      answerUsd: "48,200.72",
      updatedAt: iso(observed * 1000),
    },
    priceFeed: { chainId: 143, address: "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13", description: "AUSD / USD", kind: "chainlink" },
  };
}

function run(seed: string, at: number, block: number, body: Omit<ChainlinkRun, "txHash" | "explorerUrl" | "blockNumber" | "at" | "delivery">): ChainlinkRun {
  return { txHash: sampleHash(seed), explorerUrl: null, blockNumber: block, at: iso(at), delivery: null, ...body };
}

const BLOCK = (t: number) => 41_250_000 + Math.floor((t - Date.UTC(2026, 8, 20)) / 400);

export function placeholderChainlink(now = Date.now()): ChainlinkOverview {
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const emptyCollections = { collected: 0, collectedUnits: "0", charged: 0, liquidated: 0, skippedBy: {}, yours: { collected: 0, collectedUnits: "0", dunned: 0 }, afterReauthorization: null };
  const collectionsRuns: ChainlinkRun[] = [
    run("c0", minute + 4_000, BLOCK(minute + 4_000), { collections: { tasks: 26, executed: 0, skipped: 0, ...emptyCollections } }),
    run("c1", minute - 38_000, BLOCK(minute - 38_000), {
      collections: {
        tasks: 1,
        executed: 1,
        skipped: 0,
        ...emptyCollections,
        collected: 1,
        collectedUnits: "121830000",
        yours: { collected: 1, collectedUnits: "121830000", dunned: 0 },
        afterReauthorization: { txHash: sampleHash("r1"), explorerUrl: null, at: iso(minute - 45_000), seconds: 7, yours: true },
      },
    }),
    run("c2", minute - MINUTE + 4_000, BLOCK(minute - MINUTE + 4_000), {
      collections: { tasks: 26, executed: 2, skipped: 1, ...emptyCollections, collected: 2, collectedUnits: "171210000", skippedBy: { allowance_lost: 1 }, yours: { collected: 2, collectedUnits: "171210000", dunned: 1 } },
    }),
    run("c3", minute - 2 * MINUTE + 4_000, BLOCK(minute - 2 * MINUTE + 4_000), { collections: { tasks: 25, executed: 0, skipped: 0, ...emptyCollections } }),
    run("c4", minute - 3 * MINUTE + 4_000, BLOCK(minute - 3 * MINUTE + 4_000), {
      collections: { tasks: 25, executed: 1, skipped: 0, ...emptyCollections, charged: 1 },
    }),
  ];
  const underwriteRuns: ChainlinkRun[] = [
    run("u0", minute - 14 * MINUTE, BLOCK(minute - 14 * MINUTE), { underwrite: { applied: 1, refused: 0, items: [{ applied: true, score: 712, reason: null, buyer: null }] } }),
    run("u1", minute - 52 * MINUTE, BLOCK(minute - 52 * MINUTE), { underwrite: { applied: 0, refused: 1, items: [{ applied: false, score: null, reason: "ThinFile", buyer: null }] } }),
    run("u2", minute - 3 * 60 * MINUTE, BLOCK(minute - 3 * 60 * MINUTE), { underwrite: { applied: 1, refused: 0, items: [{ applied: true, score: 688, reason: null, buyer: null }] } }),
  ];
  const guard = placeholderGuard(now);
  const guardianRuns: ChainlinkRun[] = [0, 15, 30, 45].map((m, i) =>
    run(`g${i}`, now - (7 + m) * MINUTE, BLOCK(now - (7 + m) * MINUTE), {
      guardian: {
        accepted: true,
        round: 214 - i,
        creditPaused: false,
        reasons: [],
        price: ["0.9998", "0.9997", "0.9999", "0.9998"][i]!,
        priceRoundId: "18446744073709552612",
        freeCashUnits: "48210360000",
        observedAt: iso(now - (7 + m) * MINUTE),
        refusal: null,
      },
    }),
  );
  const cron = (schedule: string) => {
    const next = nextCronFire(schedule, now);
    return { kind: "cron" as const, label: "Cron", detail: describeCron(schedule), schedule, nextAt: next ? iso(next) : null };
  };
  const workflows: ChainlinkWorkflow[] = [
    {
      key: "collections",
      name: "polaris-collections",
      role: "Collects due Pay in 4 instalments and subscription renewals, and closes plans past their last chance.",
      receiver: null,
      receiverUrl: null,
      workflowId: null,
      triggers: [cron("0 * * * * *"), { kind: "evm-log", label: "EVM log", detail: "Reauthorized on PolarisCheckout: collects the buyer's due instalments at once" }],
      runs: collectionsRuns,
      runs24h: 1_440,
      lastRunAt: collectionsRuns[0]!.at,
    },
    {
      key: "underwrite",
      name: "polaris-underwrite",
      role: "Reads a buyer's wallet history (Nansen, Zerion, Etherscan, the chain), agrees on the facts and writes them to ScoreManager.",
      receiver: null,
      receiverUrl: null,
      workflowId: null,
      triggers: [{ kind: "http", label: "HTTP", detail: "Raise your limit in the app: the buyer's signed consent, queued by this server" }],
      runs: underwriteRuns,
      runs24h: 9,
      lastRunAt: underwriteRuns[0]!.at,
    },
    {
      key: "guardian",
      name: "polaris-guardian",
      role: "Reads Chainlink's AUSD/USD on Monad mainnet and the credit pool on Monad testnet, and pauses new Pay in 4 plans when either is unhealthy.",
      receiver: null,
      receiverUrl: null,
      workflowId: null,
      triggers: [cron("0 * * * * *")],
      runs: guardianRuns,
      runs24h: 96,
      lastRunAt: guardianRuns[0]!.at,
    },
  ];
  return {
    deployed: false,
    sample: true,
    network: { chainId: 10143, name: "Monad Testnet", explorerUrl: null },
    delivery: { forwarderKind: "simulation", forwarder: null, locked: false, workflowOwner: null },
    workflows,
    guard,
    readAt: iso(now),
  };
}
