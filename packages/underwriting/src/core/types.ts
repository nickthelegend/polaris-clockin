/**
 * Types shared by every layer: the on-chain Facts struct, the evidence the
 * providers produce, and the decision the product shows.
 *
 * Everything here is plain data. The core never touches the network, the
 * clock or the filesystem, so the Chainlink CRE workflow (compiled to WASM)
 * and the Node service run the same code on the same inputs and get the same
 * bytes out.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/**
 * `ScoreManager.Facts`, field for field and in the same order.
 *
 * uint64 fields are `bigint`; the narrower ones are `number`. The DON attests
 * these and `ScoreManager.scoreFromFacts` turns them into a score on chain.
 */
export interface Facts {
  /** uint32. Days since the oldest sign of life across the buyer's accounts. */
  walletAgeDays: number;
  /** uint32. Payments and transfers sent. */
  txCount: number;
  /** uint64. Dollars held, in 6-decimal base units. */
  stableBalance: bigint;
  /** uint32. Days since the first savings, lending or trading action. */
  defiTenureDays: number;
  /** uint16. Loans closed by an allowlisted lending pool. */
  priorLiquidations: number;
  /** uint16. Accounts set up by the same funder, when that is a cluster. */
  relatedWallets: number;
  /** First topped up from a known exchange. */
  exchangeFunded: boolean;
  /** uint64. Unix seconds when the facts were read (DON time). */
  observedAt: bigint;
}

/** The data providers, for provenance and for "from Nansen" badges. */
export type Provider = "nansen" | "zerion" | "etherscan" | "rpc" | "polaris";

/**
 * How a piece of evidence was obtained.
 *
 * - `ok`: the primary source answered.
 * - `fallback`: the primary source failed or had nothing, and a fallback answered.
 * - `empty`: a source answered and there is genuinely nothing (a known empty,
 *   such as Nansen finding no first funder, or Zerion "not trackable").
 * - `missing`: every source failed. Missing is never attested as zero.
 */
export type EvidenceStatus = "ok" | "fallback" | "empty" | "missing";

/** Where the bytes came from: a live API, or a fixture file. */
export type DataMode = "live" | "fixture";

export interface Evidence<T> {
  value: T;
  status: EvidenceStatus;
  /** `<provider>.<endpoint>`, e.g. `nansen.first-funder`. */
  source: string;
  /** Set by the Node collectors; the CRE workflow is always live. */
  mode?: DataMode;
  /** A short, non-secret note on why a fallback or a miss happened. */
  detail?: string;
}

/** Nansen's first-funder row, normalised. */
export interface Funder {
  address: Address;
  /** Nansen's label for the funder, e.g. "Coinbase: Hot Wallet 2". */
  name: string | null;
  /** Nansen chain where the first funding happened, e.g. "ethereum". */
  chain: string;
  /** Unix seconds of the funding transaction, or null when unparseable. */
  fundedAt: number | null;
}

/**
 * What we know about one subject: the buyer's Polaris account, or a history
 * wallet they linked (plan §5.5). JSON-safe (numbers, strings, booleans,
 * null), so a CRE workflow can pass it through consensus.
 */
export interface SubjectEvidence {
  address: Address;
  role: "account" | "linked";
  /** Unix seconds of the oldest activity. null: no activity at all. */
  firstSeenAt: Evidence<number | null>;
  /** Payments and transfers sent. Capped by the source (see collectors). */
  sentCount: Evidence<number>;
  /** Dollars held, 6-decimal base units, as a safe integer. */
  stableBalance: Evidence<number>;
  /** Unix seconds of the first savings, lending or trading action. */
  defiSince: Evidence<number | null>;
  /** Loans closed by an allowlisted lending pool. */
  liquidations: Evidence<number>;
  /** The first funder, from Nansen. null: Nansen has no attribution. */
  funder: Evidence<Funder | null>;
  /**
   * Accounts tied to the same funder, excluding this one. 100 means "at least
   * 100": the funder is infrastructure and the exact count does not matter.
   */
  relatedWallets: Evidence<number>;
  /** A high-risk label on this subject or its funder, or null. */
  riskLabel: Evidence<string | null>;
}

/** One line of "why is my limit this", in the buyer's words. */
export interface CreditReason {
  /** Stable id, for analytics and tests. */
  id:
    | "age"
    | "activity"
    | "balance"
    | "defi"
    | "exchange"
    | "liquidations"
    | "cluster"
    | "linked-excluded"
    | "missing";
  /** Plain language, no points: "You've used this account for 2 years". */
  label: string;
  /** The label with its points, ready to render: "… · +48". */
  text: string;
  /** Score points this line adds or removes. Lines sum to score − floor. */
  points: number;
  /** "plus" earns, "minus" costs, "neutral" is shown for completeness, "info" explains. */
  kind: "plus" | "minus" | "neutral" | "info";
  /** Which provider backs the line, so the app can credit it. */
  provider: Provider;
  /** The endpoint behind it, e.g. `nansen.first-funder`. */
  source: string;
}

/** One way the facts fall short of the evidence floor (`ATTEST_MINIMUM`, attest.ts). */
export interface AttestGap {
  fact: "walletAgeDays" | "txCount";
  /** What the facts show. */
  have: number;
  /** What the floor asks for. */
  need: number;
}

/** What the buyer can do next to raise the line. */
export interface NextStep {
  id: "link-history" | "repay" | "secure" | "retry" | "build-history";
  label: string;
}

/** A Pay in 4 quote, with the loan engine's integer arithmetic. */
export interface PlanQuote {
  principal: bigint;
  interest: bigint;
  total: bigint;
  installments: number;
  intervalSeconds: number;
  aprBps: number;
  /** Each instalment, from the engine's rounded-up threshold ladder. */
  amounts: bigint[];
}

export interface CreditDecision {
  score: number;
  declined: boolean;
  /** Plain-language reason when declined. */
  declineReason: string | null;
  /** Unsecured line in 6-decimal base units. 0 when declined. */
  limit: bigint;
  /** The highest line underwriting can open; above it only repaying counts. */
  openingCap: bigint;
  /** What is still free after open plans. */
  available: bigint;
  tier: { minScore: number; limit: bigint };
  nextTier: { minScore: number; limit: bigint; pointsNeeded: number; onTimeWeeks: number } | null;
  payIn4: {
    allowed: boolean;
    installments: number;
    intervalSeconds: number;
    aprBps: number;
    /** The largest purchase whose total with interest fits what is available. */
    maxPurchase: bigint;
    /** Why not, in plain words, when not allowed. */
    reason: string | null;
    /** The quote for the requested purchase, when one was given. */
    quote: (PlanQuote & { fits: boolean }) | null;
  };
  /**
   * Set when the facts are too thin for the DON to attest (attest.ts): no
   * report is sent and the account stays secured-only, so `limit` is 0 and
   * collateral counts at face value. Each gap says what is short and by how
   * much. Null when the facts clear the floor.
   */
  thinFile: AttestGap[] | null;
  /** One sentence for the top of the screen. */
  headline: string;
  reasons: CreditReason[];
  nextSteps: NextStep[];
}
