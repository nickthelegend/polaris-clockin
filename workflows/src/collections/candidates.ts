/**
 * Where a collections run's candidates come from. The indexer proposes, the
 * chain disposes (plan §3.3): candidates only decide which ids get checked,
 * and `CollectionsReceiver.checkTasks` at the last finalized block decides
 * what is actually due. A wrong or stale indexer can cost a wasted check,
 * never a wrong collection.
 *
 * - **Envio HyperIndex** (when `candidates.indexerUrl` is set): one GraphQL
 *   POST for the plans and subscriptions whose next attempt has come: the
 *   due time, or the next rung of the dunning ladder after a shortfall.
 * - **The chain** (no indexer, or the indexer failed): `loanCount()` and
 *   `subscriptionCount()`, then a bounded window of ids (see `chainWindow`).
 */

/**
 * The default candidate query: `DUE_CANDIDATES` from @polarispay/indexer-client
 * (packages/indexer/client/src/documents.ts), character for character.
 *
 * The indexer (packages/indexer/schema.graphql, served by Envio's Hasura) has
 * no `Loan` entity: a Pay in 4 plan is a `Plan`, aliased here to `Loan` so the
 * parser below reads both shapes. It filters on `nextAttemptAt`, not the due
 * date: the indexer moves that along the dunning ladder after each shortfall
 * (never past the moment the plan turns liquidatable), so a buyer who is short
 * is retried on the ladder's schedule rather than on every tick. Timestamps
 * are Int; `loanId` and `subId` are BigInt, which Hasura returns as strings.
 *
 * test/indexer-schema.test.ts validates this text against a Hasura-shaped
 * schema built from the indexer's schema.graphql, and against the client's
 * own document once packages/indexer is on this branch. A deployment whose
 * schema differs sets `candidates.indexerQuery`; any query works that returns
 * `Loan` and `Subscription` lists with `loanId` / `subId` (or an `id` ending
 * in the number).
 */
export const DUE_CANDIDATES_QUERY = /* GraphQL */ `
  query DueCandidates($now: Int!, $limit: Int!) {
    Loan: Plan(
      where: { status: { _eq: "ACTIVE" }, nextAttemptAt: { _lte: $now } }
      order_by: [{ nextAttemptAt: asc }, { loanId: asc }]
      limit: $limit
    ) { loanId liquidatableAt }
    Subscription(
      where: { status: { _eq: "ACTIVE" }, nextAttemptAt: { _lte: $now } }
      order_by: [{ nextAttemptAt: asc }, { subId: asc }]
      limit: $limit
    ) { subId }
  }
`;

export interface IndexerCandidates {
  loans: bigint[];
  subscriptions: bigint[];
}

/** The GraphQL request body, byte-identical on every node so CRE's cache can share it. */
export function candidatesRequestBody(query: string, now: number, limit: number): string {
  return JSON.stringify({ query, variables: { now, limit } });
}

function idOf(row: unknown, field: "loanId" | "subId"): bigint | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const direct = r[field];
  if (typeof direct === "number" && Number.isSafeInteger(direct) && direct > 0) return BigInt(direct);
  if (typeof direct === "string" && /^\d+$/.test(direct) && direct !== "0") return BigInt(direct);
  // Entities keyed `${engine}-${loanId}` (envio.md §12) or `${chainId}_${id}`.
  if (typeof r.id === "string") {
    const m = /(\d+)$/.exec(r.id);
    if (m && m[1] !== "0") return BigInt(m[1]!);
  }
  return null;
}

/**
 * Read the ids out of a GraphQL response. Throws on GraphQL errors or a
 * shape it cannot read: the caller then falls back to the chain, rather
 * than treating a broken indexer as "nothing due".
 */
export function parseIndexerCandidates(body: unknown): IndexerCandidates {
  if (typeof body !== "object" || body === null) throw new Error("indexer: response is not an object");
  const b = body as { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    throw new Error(`indexer: ${b.errors[0]?.message ?? "GraphQL error"}`);
  }
  if (typeof b.data !== "object" || b.data === null) throw new Error("indexer: response has no data");
  const loansRaw = b.data.Loan;
  const subsRaw = b.data.Subscription;
  if (!Array.isArray(loansRaw) && !Array.isArray(subsRaw)) {
    throw new Error("indexer: response has neither Loan nor Subscription");
  }
  const collect = (rows: unknown, field: "loanId" | "subId") => {
    const ids = new Set<bigint>();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = idOf(row, field);
      if (id !== null) ids.add(id);
    }
    return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  };
  return { loans: collect(loansRaw, "loanId"), subscriptions: collect(subsRaw, "subId") };
}

/**
 * Candidates as one string, so the DON agrees on them with identical
 * consensus on a primitive: `L:1,4,9|S:2`. Errors travel the same way
 * (`ERR:<message>`), so every node agrees to fall back together.
 */
export function packCandidates(c: IndexerCandidates): string {
  return `L:${c.loans.join(",")}|S:${c.subscriptions.join(",")}`;
}

export function unpackCandidates(packed: string): IndexerCandidates | { error: string } {
  if (packed.startsWith("ERR:")) return { error: packed.slice(4) };
  const m = /^L:([\d,]*)\|S:([\d,]*)$/.exec(packed);
  if (!m) return { error: `unreadable candidates "${packed.slice(0, 40)}"` };
  const ids = (s: string) => (s === "" ? [] : s.split(",").map((x) => BigInt(x)));
  return { loans: ids(m[1]!), subscriptions: ids(m[2]!) };
}
