/**
 * The workflows' configs for a local chain (`pnpm demo:local`), built in
 * memory from the committed staging templates and the chain's deployment
 * record, the way `configure local` builds config.local.json, with what a
 * local runner needs on top:
 *
 * - the forwarder the deployment's receivers trust (demo:local deploys its
 *   own MockKeystoneForwarder; chain:local plants one at the Monad testnet
 *   simulation forwarder's address);
 * - the dunning ladder's window set from the runner's interval, so every
 *   rung gets an attempt even when a run starts a few seconds late (a missed
 *   first rung would leave a failed instalment for the 6 h rung);
 * - the guardian's price: Chainlink's AUSD/USD Data Feed on Monad mainnet,
 *   read over its public RPC (what staging and production read), or the
 *   local chain's labelled MockAusdUsdFeed when offline.
 *
 * Pure: the runners pass in the files they read, and the tests call it
 * directly. Nothing here is written to the workflows' folders, so a
 * config.local.json left by `chain:local` never leaks into a demo run.
 */

// @ts-expect-error: a plain ESM script, no type declarations
import { AUSD_USD_MONAD_MAINNET, configsFor } from "../scripts/configure.mjs";
import { type CollectionsConfig, configSchema as collectionsSchema } from "../src/collections/workflow.ts";
import { type GuardianConfig, configSchema as guardianSchema } from "../src/guardian/workflow.ts";

export type LocalDeployment = {
  chainId: number;
  deployer: `0x${string}`;
  contracts: Record<string, { address: `0x${string}` } | undefined>;
  cre?: {
    /** The forwarder the receivers trust: the deployed MockKeystoneForwarder, or the address chain:local planted it at. */
    forwarder?: `0x${string}`;
    workflows?: {
      guardian?: { priceFeed?: { address?: string; decimals?: number; description?: string; kind?: string; chainSelectorName?: string | null } };
    };
  };
};

export type PriceSource = "mainnet" | "mock";

/** Chainlink AUSD/USD on Monad mainnet, as the guardian's staging and production configs read it. */
export const MAINNET_AUSD_USD = {
  chainSelectorName: "monad-mainnet",
  address: AUSD_USD_MONAD_MAINNET as `0x${string}`,
  decimals: 8,
  description: "AUSD / USD",
  kind: "chainlink",
} as const;

/** The public Monad mainnet RPC the guardian reads the feed through (reads only). */
export const MONAD_MAINNET_RPC = "https://rpc.monad.xyz";
export const MONAD_MAINNET_CHAIN_ID = 143;

export type LocalConfigOptions = {
  /** Seconds between the collections runner's cron runs. */
  collectionsEverySeconds: number;
  /** Seconds between the guardian runner's cron runs. */
  guardianEverySeconds: number;
  /** Where the guardian reads AUSD/USD. */
  price: PriceSource;
  /** The API's callback URL for the workflows' signed callbacks, or null for none. */
  callbackUrl: string | null;
};

export const CALLBACK_SECRET_ID = "POLARIS_CALLBACK_SECRET";

/** A six-field cron (seconds first) that fires every `seconds` (a divisor of 60, or whole minutes). */
export function everyCron(seconds: number): string {
  if (seconds < 60 && 60 % seconds === 0) return `*/${seconds} * * * * *`;
  if (seconds % 60 === 0 && seconds / 60 < 60) return `0 */${seconds / 60} * * * *`;
  throw new Error(`a local runner's interval must divide a minute or be whole minutes under an hour (got ${seconds} s)`);
}

/**
 * How long after a rung a run may still attempt it: the time between runs,
 * plus slack for a run that starts late (the runner mines a block first, and
 * a slow run delays the next). Two attempts on one rung are harmless (the
 * second is a skip); none would wait for the next rung, hours away.
 */
export function rungWindow(everySeconds: number): number {
  return Math.max(30, everySeconds + Math.ceil(everySeconds / 2));
}

export function localConfigs(
  d: LocalDeployment,
  templates: { collections: unknown; underwriting: unknown; guardian: unknown },
  o: LocalConfigOptions,
): { collections: CollectionsConfig; guardian: GuardianConfig } {
  const forwarder = d.cre?.forwarder ?? d.contracts.MockKeystoneForwarder?.address;
  if (!forwarder) throw new Error("the deployment records no forwarder: local runners deliver through the local chain's own MockKeystoneForwarder");
  const out = configsFor("local", d, templates, { callback: o.callbackUrl ?? "" }) as { collections: Record<string, unknown>; guardian: Record<string, unknown> };
  const candidates = out.collections.candidates as { chainBackoff?: { ladderSeconds: number[]; windowSeconds: number } | null } & Record<string, unknown>;
  const collections = collectionsSchema.parse({
    ...out.collections,
    schedule: everyCron(o.collectionsEverySeconds),
    forwarder,
    // No indexer locally: the chain proposes the candidates.
    candidates: {
      ...candidates,
      indexerUrl: null,
      indexerQuery: null,
      chainBackoff: candidates.chainBackoff ? { ...candidates.chainBackoff, windowSeconds: rungWindow(o.collectionsEverySeconds) } : null,
    },
  });
  const guardian = guardianSchema.parse({
    ...out.guardian,
    schedule: everyCron(o.guardianEverySeconds),
    forwarder,
    priceFeed: o.price === "mainnet" ? MAINNET_AUSD_USD : out.guardian.priceFeed,
  });
  if (o.price === "mock" && guardian.priceFeed.kind !== "mock") {
    throw new Error("the local record's price feed is not the labelled mock: refusing to call it Chainlink");
  }
  return { collections, guardian };
}
