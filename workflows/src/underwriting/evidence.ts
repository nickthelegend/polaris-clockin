/**
 * The underwriting data run, in node mode: every node of the DON drives the
 * underwriting package's recipe (the same generators the Node service runs)
 * through CRE's HTTP client, derives the Facts with the package's pure core,
 * and the DON agrees on the result field by field.
 *
 *   - Nansen first-funder and related-wallets date the history wallet,
 *     name the exchange it was topped up from and run the sybil check;
 *     Nansen's balance and transactions are the fallbacks for Zerion.
 *   - Zerion reads the Polaris account's Monad testnet history, the history
 *     wallet's exact balances and its trading tenure, and dates a wallet
 *     Nansen has no first funder for.
 *   - Etherscan counts allowlisted-pool liquidations; RPC nonces count sends.
 *
 * Every request carries `cacheSettings`, so one node's paid call is shared by
 * the DON (best effort) and the others read the same bytes, which is what
 * lets identical consensus hold on the evidence. Keys never appear in URLs or
 * logs: the recipe's requests carry none, and auth is added here.
 */

import { cre, type NodeRuntime } from "@chainlink/cre-sdk";
import {
  accountRecipe,
  all,
  type Collected,
  linkedRecipe,
  type RecipeOptions,
  type Reply,
  type RequestSpec,
  runSync,
  underwrite,
  zerion,
} from "@polarispay/underwriting/core";
import type { Address } from "viem";
import { base64Utf8 } from "../shared/callback.ts";

/** Provider keys, read from CRE secrets in DON mode and handed down. */
export interface ProviderKeys {
  nansen: string | null;
  zerion: string | null;
  etherscan: string | null;
}

export interface EvidenceRequest {
  user: Address;
  /** A history wallet whose ownership the DON already verified, or null. */
  wallet: Address | null;
  /** DON time, unix seconds: the Facts' `observedAt`. */
  now: number;
  /** The account's dollars, from EVM reads (6-decimal base units). */
  accountBalance: number;
  keys: ProviderKeys;
  recipe: Omit<RecipeOptions, "now" | "accountBalance">;
  /** HTTP calls this run may make: CRE allows 15 per execution. */
  httpBudget: number;
  /** Seconds a response may be reused across nodes (CRE caps this at 600). */
  cacheMaxAgeSeconds: number;
  allowPartial: boolean;
}

/**
 * What each node reports, flat and primitive so the DON can aggregate each
 * field: counts by median, verdicts by identical.
 */
export interface Observation {
  final: boolean;
  /** `<role>.<field>` list, comma-joined: what kept the run from being final. */
  missing: string;
  walletAgeDays: number;
  txCount: number;
  stableBalance: bigint;
  defiTenureDays: number;
  priorLiquidations: number;
  relatedWallets: number;
  exchangeFunded: boolean;
  /** The score ScoreManager will compute from these facts (the core's mirror). */
  score: number;
  httpCalls: number;
  /** Provider failures, comma-joined `source:code`, for the run log. */
  issues: string;
}

/** Headers and URL with the provider's key added. The recipe's own spec never holds one. */
export function authorize(spec: RequestSpec, keys: ProviderKeys): { url: string; headers: Record<string, string> } | { missingKey: string } {
  const headers: Record<string, string> = { ...spec.headers };
  if (spec.provider === "nansen") {
    if (!keys.nansen) return { missingKey: "nansen" };
    headers.apikey = keys.nansen;
    if (spec.body !== undefined) headers["content-type"] = "application/json";
    return { url: spec.url, headers };
  }
  if (spec.provider === "zerion") {
    if (!keys.zerion) return { missingKey: "zerion" };
    headers.authorization = zerion.zerionAuthorization(keys.zerion);
    return { url: spec.url, headers };
  }
  if (spec.provider === "etherscan") {
    if (!keys.etherscan) return { missingKey: "etherscan" };
    return { url: `${spec.url}&apikey=${encodeURIComponent(keys.etherscan)}`, headers };
  }
  if (spec.body !== undefined) headers["content-type"] = "application/json";
  return { url: spec.url, headers };
}

/** A recipe sender over CRE's HTTP client, with a hard call budget. */
export function creSender(
  nodeRuntime: NodeRuntime<unknown>,
  req: Pick<EvidenceRequest, "keys" | "httpBudget" | "cacheMaxAgeSeconds">,
  log: RequestSpec[] = [],
): (spec: RequestSpec) => Reply {
  const http = new cre.capabilities.HTTPClient();
  return (spec) => {
    const auth = authorize(spec, req.keys);
    if ("missingKey" in auth) {
      return { ok: false, code: "unauthorized", retryable: false, retryAfterMs: null, message: `${spec.provider}: no API key configured` };
    }
    if (log.length >= req.httpBudget) {
      return {
        ok: false,
        code: "budget_exhausted",
        retryable: true,
        retryAfterMs: 30_000,
        message: `${spec.provider}.${spec.endpoint}: over the ${req.httpBudget}-call budget for one execution`,
      };
    }
    log.push(spec);
    try {
      const res = http
        .sendRequest(nodeRuntime, {
          url: auth.url,
          method: spec.method,
          ...(spec.body !== undefined ? { body: base64Utf8(spec.body) } : {}),
          multiHeaders: Object.fromEntries(Object.entries(auth.headers).map(([k, v]) => [k, { values: [v] }])),
          timeout: "10s",
          cacheSettings: { store: true, maxAge: `${req.cacheMaxAgeSeconds}s` },
        })
        .result();
      const text = new TextDecoder().decode(res.body);
      let body: unknown = text;
      try {
        body = text === "" ? null : JSON.parse(text);
      } catch {
        // not JSON: the recipe's parsers report a parse error for it
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.multiHeaders ?? {})) {
        const first = v.values[0];
        if (first !== undefined) headers[k.toLowerCase()] = first;
      }
      return { ok: true, status: res.statusCode, body, headers };
    } catch (e) {
      return {
        ok: false,
        code: "network_error",
        retryable: true,
        retryAfterMs: null,
        message: `${spec.provider}.${spec.endpoint}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
      };
    }
  };
}

/** Node mode: gather the evidence, derive the Facts, report one observation. */
export function observe(nodeRuntime: NodeRuntime<unknown>, req: EvidenceRequest): Observation {
  const log: RequestSpec[] = [];
  const send = creSender(nodeRuntime, req, log);
  const options: RecipeOptions = { ...req.recipe, now: req.now, accountBalance: req.accountBalance };

  let account: Collected;
  let linked: Collected | null = null;
  if (req.wallet) {
    [account, linked] = runSync(all<[Collected, Collected]>([accountRecipe(req.user, options), linkedRecipe(req.wallet, options)]), send);
  } else {
    account = runSync(accountRecipe(req.user, options), send);
  }

  const out = underwrite({
    user: req.user,
    observedAt: req.now,
    account: account.evidence,
    linked: linked?.evidence ?? null,
    // The DON checked the wallet's signature before this ran (link.ts).
    linkVerified: req.wallet !== null,
    options: { allowPartial: req.allowPartial },
  });
  const issues = [...new Set([...account.issues, ...(linked?.issues ?? [])].map((i) => `${i.source}:${i.code}`))].join(",");
  if (issues) nodeRuntime.log(`provider issues: ${issues.slice(0, 900)}`);
  return {
    final: out.final,
    missing: out.missing.join(","),
    walletAgeDays: out.facts.walletAgeDays,
    txCount: out.facts.txCount,
    stableBalance: out.facts.stableBalance,
    defiTenureDays: out.facts.defiTenureDays,
    priorLiquidations: out.facts.priorLiquidations,
    relatedWallets: out.facts.relatedWallets,
    exchangeFunded: out.facts.exchangeFunded,
    score: out.breakdown.score,
    httpCalls: log.length,
    issues: issues.slice(0, 400),
  };
}
