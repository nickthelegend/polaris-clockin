#!/usr/bin/env node
/**
 * Fill each workflow's config for a target from a contracts deployment record.
 *
 *   pnpm --filter @polaris/cre-workflows configure staging      # after deploy:monad
 *   pnpm --filter @polaris/cre-workflows configure production   # after the move to the production forwarder
 *   pnpm --filter @polaris/cre-workflows configure local        # chain:local does this for you
 *
 * Reads packages/contracts/deployments/monad-testnet.json (staging,
 * production) or workflows/.local/deployment.json (local), and writes the
 * contract addresses, the forwarder, the stablecoins and the workflow owner
 * into collections/ and underwriting/config.<target>.json, keeping every
 * other setting. It refuses a record whose forwarder does not match the
 * target, so a staging config never points at the production forwarder or
 * the other way round.
 *
 * Options: --deployment <file> to read another record; --indexer <url> to set
 * the Envio GraphQL endpoint (the Polaris indexer, packages/indexer: the
 * workflow's default query is its client's DUE_CANDIDATES, so this also clears
 * any candidates.indexerQuery left in the config); --indexer-query <file> for
 * an indexer with another schema; --callback <url> to set where run callbacks
 * go; --authorized-key <address> for the key the Polaris API signs
 * underwriting trigger requests with (required once deployed; simulation
 * needs none).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = join(ROOT, "..", "packages", "contracts");

/** Chainlink's forwarders on Monad testnet (docs/research/cre.md §4, verified on chain). */
export const FORWARDERS = {
  simulation: "0xB9F79d863261869B234c481D1f9A7af84AeAd192",
  production: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482",
};
/** Circle USDC on Monad testnet (plan Appendix A): dollars the account may also hold. */
export const MONAD_TESTNET_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

const TARGETS = {
  local: { file: "config.local.json", template: "config.staging.json", deployment: join(ROOT, ".local", "deployment.json"), forwarder: FORWARDERS.simulation },
  staging: { file: "config.staging.json", template: "config.staging.json", deployment: join(CONTRACTS, "deployments", "monad-testnet.json"), forwarder: FORWARDERS.simulation },
  production: { file: "config.production.json", template: "config.production.json", deployment: join(CONTRACTS, "deployments", "monad-testnet.json"), forwarder: FORWARDERS.production },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function addressOf(record, name) {
  const a = record.contracts?.[name]?.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) throw new Error(`deployment has no ${name} address`);
  return a;
}

/** The two configs for `target`, from `record`. Pure, for the tests. */
export function configsFor(target, record, templates, opts = {}) {
  const t = TARGETS[target];
  if (!t) throw new Error(`unknown target "${target}" (local, staging, production)`);
  const cre = record.cre ?? {};
  if (target === "production") {
    if (cre.forwarderKind !== "production" && cre.forwarder?.toLowerCase() !== FORWARDERS.production.toLowerCase()) {
      throw new Error(
        "the deployment's receivers still trust the simulation forwarder: switch them to the production KeystoneForwarder first (packages/contracts/README.md, 'Forwarders on Monad testnet')",
      );
    }
  } else if (target === "staging" && cre.forwarder?.toLowerCase() !== FORWARDERS.simulation.toLowerCase()) {
    throw new Error(`staging simulates through ${FORWARDERS.simulation}, but the deployment's receivers trust ${cre.forwarder}`);
  }
  const stable = addressOf(record, "Stablecoin");
  const stablecoins = target === "local" ? [stable] : [...new Set([stable, MONAD_TESTNET_USDC])];

  const collections = {
    ...templates.collections,
    receiver: addressOf(record, "CollectionsReceiver"),
    loanEngine: addressOf(record, "PolarisLoanEngine"),
    payments: addressOf(record, "PolarisPayments"),
    forwarder: t.forwarder,
  };
  const underwriting = {
    ...templates.underwriting,
    receiver: addressOf(record, "UnderwritingReceiver"),
    scoreManager: addressOf(record, "ScoreManager"),
    forwarder: t.forwarder,
    stablecoins,
  };
  if (target === "local") {
    // The local chain answers every minute; keep its runs quick and its windows small.
    collections.schedule = "*/30 * * * * *";
    // One attempt per rung of the dunning ladder at that pace (src/collections/backoff.ts).
    const ladder = collections.candidates?.chainBackoff;
    if (ladder) collections.candidates = { ...collections.candidates, chainBackoff: { ...ladder, windowSeconds: 30 } };
  }
  if (opts.indexer !== undefined) {
    // A query left over from another indexer would fail against this one, and a
    // failing indexer only shows as a quiet fall back to the chain every run.
    collections.candidates = { ...collections.candidates, indexerUrl: opts.indexer || null, indexerQuery: opts.indexerQuery || null };
  } else if (opts.indexerQuery !== undefined) {
    collections.candidates = { ...collections.candidates, indexerQuery: opts.indexerQuery || null };
  }
  if (opts.authorizedKey !== undefined) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.authorizedKey)) throw new Error("--authorized-key must be an address");
    underwriting.authorizedKeys = [opts.authorizedKey];
  }
  if (opts.callback !== undefined) {
    const cb = opts.callback ? { url: opts.callback, secretId: "POLARIS_CALLBACK_SECRET" } : null;
    collections.callback = cb;
    underwriting.callback = cb;
  }
  return { collections, underwriting };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function configure(target, opts = {}) {
  const t = TARGETS[target];
  if (!t) throw new Error(`unknown target "${target}" (local, staging, production)`);
  const deployment = opts.deployment ?? t.deployment;
  if (!existsSync(deployment)) {
    throw new Error(
      target === "local"
        ? `no local deployment at ${deployment}: run \`pnpm --filter @polaris/cre-workflows chain:local\``
        : `no deployment at ${deployment}: run \`pnpm --filter @polarispay/contracts deploy:monad\` first`,
    );
  }
  const record = readJson(deployment);
  const templates = {
    collections: readJson(join(ROOT, "collections", t.template)),
    underwriting: readJson(join(ROOT, "underwriting", t.template)),
  };
  const out = configsFor(target, record, templates, opts);
  const written = [];
  for (const w of ["collections", "underwriting"]) {
    const file = join(ROOT, w, t.file);
    writeFileSync(file, `${JSON.stringify(out[w], null, 2)}\n`);
    written.push(file);
  }
  return { record, written, ...out };
}

if (process.argv[1] && /configure\.mjs$/.test(process.argv[1])) {
  const target = process.argv[2];
  try {
    const queryFile = arg("indexer-query");
    const { written, record } = configure(target, {
      deployment: arg("deployment"),
      indexer: arg("indexer"),
      indexerQuery: queryFile === undefined ? undefined : readFileSync(queryFile, "utf8").trim(),
      callback: arg("callback"),
      authorizedKey: arg("authorized-key"),
    });
    console.log(`Configured ${target} from ${record.network} (chain ${record.chainId}):`);
    for (const f of written) console.log(`  ${f}`);
    if (target === "production" && !arg("authorized-key")) {
      console.log("Note: underwriting still needs --authorized-key <address the Polaris API signs trigger requests with>.");
    }
  } catch (e) {
    console.error(e.message ?? e);
    process.exitCode = 1;
  }
}
