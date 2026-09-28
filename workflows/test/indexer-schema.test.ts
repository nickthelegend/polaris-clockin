/**
 * The candidate query against the indexer it is sent to.
 *
 * The collections workflow falls back to the chain whenever the indexer
 * answers with an error, so a query the indexer's schema does not have never
 * fails a run: it quietly turns every run into a chain sweep, which knows
 * nothing of the dunning ladder. These tests hold the query to the indexer's
 * own schema (packages/indexer/schema.graphql, as Envio's Hasura serves it)
 * and run it over rows, so that mismatch fails here instead.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse, validate } from "graphql";
import { candidatesRequestBody, DUE_CANDIDATES_QUERY, parseIndexerCandidates } from "../src/collections/candidates.ts";
import { configSchema as collectionsSchema } from "../src/collections/workflow.ts";
import { answerHasura, indexerSchema, indexerSchemaSource, LIVE_INDEXER_DOCUMENTS, type Row } from "./helpers/hasura.ts";
import { fs } from "./helpers/host.ts";
// @ts-expect-error: a plain ESM script, no type declarations
import { configsFor, FORWARDERS } from "../scripts/configure.mjs";

const ROOT = join(import.meta.dir, "..");
const json = (p: string) => JSON.parse(fs.readFileSync(join(ROOT, p), "utf8"));
const errorsOf = (query: string) => validate(indexerSchema(), parse(query)).map((e) => e.message);

const NOW = 1_790_424_000;
const HOUR = 3600;

/** A Plan row with the columns the query reads (BigInt columns as strings, as Hasura returns them). */
const plan = (loanId: number, nextAttemptAt: number | null, over: Partial<Row> = {}): Row => ({
  id: String(loanId),
  loanId: String(loanId),
  status: "ACTIVE",
  nextAttemptAt,
  liquidatableAt: null,
  ...over,
});
const subscription = (subId: number, nextAttemptAt: number | null, over: Partial<Row> = {}): Row => ({
  id: String(subId),
  subId: String(subId),
  status: "ACTIVE",
  nextAttemptAt,
  ...over,
});

describe("the default candidate query", () => {
  test(`is valid against the indexer's schema (${indexerSchemaSource().live ? "packages/indexer" : "the snapshot in test/fixtures/indexer"})`, () => {
    expect(errorsOf(DUE_CANDIDATES_QUERY)).toEqual([]);
  });

  test("the validator is not a rubber stamp: the old `Loan … nextDueAt` query is refused as Hasura refuses it", () => {
    const old = `query DueCandidates($now: Int!, $limit: Int!) {
  Loan(where: { status: { _eq: "ACTIVE" }, nextDueAt: { _lte: $now } }, order_by: { nextDueAt: asc }, limit: $limit) { loanId }
  Subscription(where: { status: { _eq: "ACTIVE" }, nextChargeAt: { _lte: $now } }, order_by: { nextChargeAt: asc }, limit: $limit) { subId }
}`;
    expect(errorsOf(old)).toContain('Cannot query field "Loan" on type "query_root". Did you mean "Plan"?');
  });

  test.skipIf(!fs.existsSync(LIVE_INDEXER_DOCUMENTS))("is @polarispay/indexer-client's own DUE_CANDIDATES", async () => {
    const { DUE_CANDIDATES } = (await import(LIVE_INDEXER_DOCUMENTS)) as { DUE_CANDIDATES: string };
    expect(DUE_CANDIDATES_QUERY).toBe(DUE_CANDIDATES);
  });

  test("the indexer's answer parses to the plans and subscriptions whose attempt has come, dunning backoff honoured", () => {
    const tables = {
      Plan: [
        plan(9, NOW - 2 * HOUR),
        plan(3, NOW - HOUR),
        plan(4, NOW + 6 * HOUR), // short on funds last run: the ladder's next rung is later
        plan(5, NOW - HOUR, { status: "REPAID" }),
        plan(6, null, { status: "LIQUIDATED" }),
        plan(12, NOW), // due this very second
      ],
      Subscription: [subscription(2, NOW - 60), subscription(7, NOW + HOUR), subscription(8, NOW - 60, { status: "CANCELLED" })],
    };
    const answer = answerHasura(candidatesRequestBody(DUE_CANDIDATES_QUERY, NOW, 100), tables);
    expect(answer.errors).toBeUndefined();
    expect(parseIndexerCandidates(answer)).toEqual({ loans: [3n, 9n, 12n], subscriptions: [2n] });
  });

  test("`limit` caps each list, oldest attempt first", () => {
    const tables = { Plan: [plan(1, NOW - 10), plan(2, NOW - 30), plan(3, NOW - 20)], Subscription: [] };
    const answer = answerHasura(candidatesRequestBody(DUE_CANDIDATES_QUERY, NOW, 2), tables);
    expect(parseIndexerCandidates(answer)).toEqual({ loans: [2n, 3n], subscriptions: [] });
  });

  test("a query the indexer does not have comes back as a GraphQL error, which the workflow reads as 'fall back'", () => {
    const answer = answerHasura(candidatesRequestBody("query { Loan { loanId } }", NOW, 1), {});
    expect(() => parseIndexerCandidates(answer)).toThrow(/indexer: Cannot query field "Loan"/);
  });
});

describe("configure --indexer", () => {
  const record = {
    network: "monadTestnet",
    chainId: 10143,
    contracts: Object.fromEntries(
      ["Stablecoin", "ScoreManager", "PolarisLoanEngine", "PolarisPayments", "CollectionsReceiver", "UnderwritingReceiver"].map((n, i) => [
        n,
        { address: `0x${(0x1000 + i).toString(16).padStart(40, "0")}` },
      ]),
    ),
    cre: { forwarderKind: "simulation", forwarder: FORWARDERS.simulation },
  };
  const templates = { collections: json("collections/config.staging.json"), underwriting: json("underwriting/config.staging.json") };
  const sentQuery = (collections: unknown) => {
    const cfg = collectionsSchema.parse(collections);
    return JSON.parse(candidatesRequestBody(cfg.candidates.indexerQuery ?? DUE_CANDIDATES_QUERY, NOW, cfg.candidates.indexerLimit)).query as string;
  };

  test("configures a workflow whose request the indexer accepts", () => {
    const out = configsFor("staging", record, templates, { indexer: "https://indexer.dev.hyperindex.xyz/abc/v1/graphql" });
    expect(out.collections.candidates.indexerUrl).toBe("https://indexer.dev.hyperindex.xyz/abc/v1/graphql");
    expect(errorsOf(sentQuery(out.collections))).toEqual([]);
  });

  test("drops a stale indexerQuery left in the config, so the Polaris indexer gets the query it has", () => {
    const stale = { ...templates, collections: { ...templates.collections, candidates: { ...templates.collections.candidates, indexerQuery: "query { Loan { loanId } }" } } };
    const out = configsFor("staging", record, stale, { indexer: "https://indexer.dev.hyperindex.xyz/abc/v1/graphql" });
    expect(out.collections.candidates.indexerQuery).toBeNull();
    expect(errorsOf(sentQuery(out.collections))).toEqual([]);
  });

  test("--indexer-query sets a query for an indexer with another schema", () => {
    const custom = "query DueCandidates($now: Int!, $limit: Int!) { Loan: Plan(limit: $limit, where: { nextDueAt: { _lte: $now } }) { loanId } }";
    const out = configsFor("staging", record, templates, { indexer: "https://example.test/graphql", indexerQuery: custom });
    expect(out.collections.candidates.indexerQuery).toBe(custom);
  });

  for (const file of ["collections/config.staging.json", "collections/config.production.json"]) {
    test(`${file}: any indexerQuery it ships is one the indexer accepts`, () => {
      const q = json(file).candidates.indexerQuery as string | null;
      expect(errorsOf(q ?? DUE_CANDIDATES_QUERY)).toEqual([]);
    });
  }
});
