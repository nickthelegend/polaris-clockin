/**
 * The Polaris indexer as the collections workflow meets it: Envio's Hasura
 * over packages/indexer/schema.graphql.
 *
 * `hasuraSchema` is @polarispay/indexer-client's test schema
 * (packages/indexer/client/test/hasura.ts), unchanged: the way envio 3.12.1
 * sets Hasura up, one root field per entity with where / order_by / limit /
 * offset, BigInt as `numeric`, relations as `<field>` plus `<field>_id`, and
 * the `_meta` view. `answerHasura` executes a request against it over
 * in-memory rows, so a query the real indexer would refuse fails here too,
 * with Hasura's own error shape (`{ errors: [{ message }] }`).
 *
 * `indexerSchemaSource` prefers the live packages/indexer/schema.graphql and
 * falls back to the snapshot in test/fixtures/indexer (metropolis/indexer at
 * 3987062) while that package is not on this branch.
 */

import { join } from "node:path";
import {
  buildSchema,
  type FieldDefinitionNode,
  type GraphQLSchema,
  graphqlSync,
  Kind,
  type ObjectTypeDefinitionNode,
  parse,
  type TypeNode,
} from "graphql";
import { fs } from "./host.ts";

const SCALARS: Record<string, string> = {
  ID: "String",
  String: "String",
  Int: "Int",
  Float: "float8",
  Boolean: "Boolean",
  BigInt: "numeric",
  BigDecimal: "numeric",
  Bytes: "String",
  Timestamp: "timestamptz",
  Json: "jsonb",
};

function named(t: TypeNode): string {
  return t.kind === Kind.NAMED_TYPE ? t.name.value : named(t.type);
}
const isList = (t: TypeNode): boolean => (t.kind === Kind.NON_NULL_TYPE ? isList(t.type) : t.kind === Kind.LIST_TYPE);
const isNonNull = (t: TypeNode) => t.kind === Kind.NON_NULL_TYPE;

export function hasuraSchema(sdl: string): GraphQLSchema {
  const doc = parse(sdl);
  const entities = doc.definitions.filter((d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION);
  const names = new Set(entities.map((e) => e.name.value));
  const out: string[] = [];

  out.push("scalar numeric", "scalar float8", "scalar timestamptz", "scalar jsonb");
  out.push("enum order_by { asc asc_nulls_first asc_nulls_last desc desc_nulls_first desc_nulls_last }");
  for (const s of ["String", "Int", "Boolean", "numeric", "float8", "timestamptz", "jsonb"]) {
    const extra = s === "String" ? " _like: String _ilike: String _nlike: String _nilike: String _regex: String" : "";
    out.push(
      `input ${s}_comparison_exp { _eq: ${s} _neq: ${s} _gt: ${s} _gte: ${s} _lt: ${s} _lte: ${s} _in: [${s}!] _nin: [${s}!] _is_null: Boolean${extra} }`,
    );
  }

  const listArgs = (t: string) => `(where: ${t}_bool_exp, order_by: [${t}_order_by!], limit: Int, offset: Int)`;
  const roots: string[] = [];

  for (const e of entities) {
    const t = e.name.value;
    const fields: string[] = ["chainId: Int!"];
    const bool: string[] = [`_and: [${t}_bool_exp!]`, `_or: [${t}_bool_exp!]`, `_not: ${t}_bool_exp`, "chainId: Int_comparison_exp"];
    const order: string[] = ["chainId: order_by"];
    for (const f of (e.fields ?? []) as FieldDefinitionNode[]) {
      const name = f.name.value;
      const base = named(f.type);
      const derived = f.directives?.some((d) => d.name.value === "derivedFrom");
      if (names.has(base)) {
        if (derived || isList(f.type)) {
          fields.push(`${name}${listArgs(base)}: [${base}!]!`);
          bool.push(`${name}: ${base}_bool_exp`);
        } else {
          fields.push(`${name}: ${base}${isNonNull(f.type) ? "!" : ""}`, `${name}_id: String${isNonNull(f.type) ? "!" : ""}`);
          bool.push(`${name}: ${base}_bool_exp`, `${name}_id: String_comparison_exp`);
          order.push(`${name}: ${base}_order_by`, `${name}_id: order_by`);
        }
        continue;
      }
      const scalar = SCALARS[base];
      if (!scalar) throw new Error(`${t}.${name}: unknown type ${base}`);
      fields.push(`${name}: ${scalar}${isNonNull(f.type) ? "!" : ""}`);
      bool.push(`${name}: ${scalar}_comparison_exp`);
      order.push(`${name}: order_by`);
    }
    out.push(`type ${t} { ${fields.join(" ")} }`);
    out.push(`input ${t}_bool_exp { ${bool.join(" ")} }`);
    out.push(`input ${t}_order_by { ${order.join(" ")} }`);
    roots.push(`${t}${listArgs(t)}: [${t}!]!`, `${t}_by_pk(id: String!, chainId: Int!): ${t}`);
  }

  // Envio's indexing status: the `_meta` view (envio 3.12.1, src/db/InternalTable.res).
  out.push(
    "scalar float4",
    "type _meta { chainId: Int! ecosystem: String startBlock: Int endBlock: Int progressBlock: Int! progressBlockTime: timestamptz bufferBlock: Int firstEventBlock: Int eventsProcessed: float4 sourceBlock: Int readyAt: timestamptz isReady: Boolean! }",
    "input _meta_bool_exp { chainId: Int_comparison_exp }",
  );
  roots.push("_meta(where: _meta_bool_exp): [_meta!]!");
  out.push(`type query_root { ${roots.join(" ")} }`, "schema { query: query_root }");
  return buildSchema(out.join("\n"));
}

const REPO = join(import.meta.dir, "..", "..", "..");
/** The indexer's own schema, once packages/indexer is on this branch. */
export const LIVE_INDEXER_SCHEMA = join(REPO, "packages", "indexer", "schema.graphql");
/** @polarispay/indexer-client's documents, once packages/indexer is on this branch. */
export const LIVE_INDEXER_DOCUMENTS = join(REPO, "packages", "indexer", "client", "src", "documents.ts");
/** packages/indexer/schema.graphql from metropolis/indexer at 3987062. */
export const SNAPSHOT_INDEXER_SCHEMA = join(import.meta.dir, "..", "fixtures", "indexer", "schema.graphql");

export function indexerSchemaSource(): { path: string; live: boolean; sdl: string } {
  const live = fs.existsSync(LIVE_INDEXER_SCHEMA);
  const path = live ? LIVE_INDEXER_SCHEMA : SNAPSHOT_INDEXER_SCHEMA;
  return { path, live, sdl: fs.readFileSync(path, "utf8") };
}

let cached: GraphQLSchema | null = null;
/** The Hasura-shaped schema of the indexer (live if present, else the snapshot). */
export function indexerSchema(): GraphQLSchema {
  cached ??= hasuraSchema(indexerSchemaSource().sdl);
  return cached;
}

/* ── Executing a request over in-memory rows ───────────────────────────── */

export type Row = Record<string, unknown>;
/** Rows per entity, with BigInt columns as decimal strings (as Hasura returns them) and Int columns as numbers. */
export type Tables = Record<string, Row[]>;

const INTEGER = /^-?\d+$/;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  if (INTEGER.test(sa) && INTEGER.test(sb)) {
    const x = BigInt(sa);
    const y = BigInt(sb);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Hasura's bool_exp over one row: SQL semantics, so a NULL column fails every comparison but `_is_null`. */
function matches(row: Row, where: Record<string, unknown> | null | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === "_and") {
      if (!(cond as Array<Record<string, unknown>>).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "_or") {
      if (!(cond as Array<Record<string, unknown>>).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "_not") {
      if (matches(row, cond as Record<string, unknown>)) return false;
      continue;
    }
    const value = row[key];
    for (const [op, arg] of Object.entries(cond as Record<string, unknown>)) {
      if (op === "_is_null") {
        if ((value === null || value === undefined) !== arg) return false;
        continue;
      }
      if (value === null || value === undefined) return false;
      const c = (x: unknown) => compare(value, x);
      const ok =
        op === "_eq" ? c(arg) === 0
        : op === "_neq" ? c(arg) !== 0
        : op === "_gt" ? c(arg) > 0
        : op === "_gte" ? c(arg) >= 0
        : op === "_lt" ? c(arg) < 0
        : op === "_lte" ? c(arg) <= 0
        : op === "_in" ? (arg as unknown[]).some((x) => c(x) === 0)
        : op === "_nin" ? (arg as unknown[]).every((x) => c(x) !== 0)
        : (() => {
            throw new Error(`answerHasura: operator ${op} is not modelled`);
          })();
      if (!ok) return false;
    }
  }
  return true;
}

function sortRows(rows: Row[], orderBy: Array<Record<string, string>> | Record<string, string> | null | undefined): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      // Postgres: NULLs sort last ascending, first descending, unless told otherwise.
      const nullsFirst = dir.endsWith("nulls_first") || dir === "desc";
      if (av === null || av === undefined) return nullsFirst ? -1 : 1;
      if (bv === null || bv === undefined) return nullsFirst ? 1 : -1;
      const c = compare(av, bv);
      if (c !== 0) return dir.startsWith("desc") ? -c : c;
    }
    return 0;
  });
}

/**
 * Answer one GraphQL POST body (`{ query, variables }`) the way the indexer
 * would: validation errors for a query the schema does not have, else rows
 * filtered, ordered and limited as the query asks.
 */
export function answerHasura(body: string, tables: Tables, schema: GraphQLSchema = indexerSchema()): { data?: unknown; errors?: Array<{ message: string }> } {
  const { query, variables } = JSON.parse(body) as { query: string; variables?: Record<string, unknown> };
  const rootValue: Record<string, unknown> = {};
  const entities = Object.keys(schema.getQueryType()?.getFields() ?? {}).filter((f) => !f.endsWith("_by_pk") && f !== "_meta");
  for (const entity of entities) {
    const rows = tables[entity] ?? [];
    rootValue[entity] = (args: { where?: Record<string, unknown>; order_by?: Array<Record<string, string>>; limit?: number; offset?: number }) => {
      const hit = sortRows(rows.filter((r) => matches(r, args.where)), args.order_by);
      const from = args.offset ?? 0;
      return hit.slice(from, args.limit === undefined ? undefined : from + args.limit);
    };
  }
  const result = graphqlSync({ schema, source: query, variableValues: variables, rootValue });
  if (result.errors?.length) return { errors: result.errors.map((e) => ({ message: e.message })) };
  return { data: result.data };
}
