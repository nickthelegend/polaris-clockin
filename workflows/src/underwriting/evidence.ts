/**
 * The underwriting data run: the underwriting package's recipe (the same
 * generators the Node service runs), driven through one of two CRE
 * transports, and the Facts derived with the package's pure core.
 *
 * - **Plain HTTP, node mode** (`observe`): every node of the DON sends the
 *   requests itself with its own copy of the provider keys, derives the
 *   Facts, and the DON agrees on them field by field.
 * - **Confidential HTTP** (`observeConfidential`, `confidentialHttp: true`):
 *   the paid calls (Nansen, Zerion, Etherscan) go out once, from Chainlink's
 *   Confidential HTTP enclave, which resolves `{{.SECRET}}` placeholders from
 *   the Vault DON inside the enclave. The workflow never reads a provider
 *   key, so no node ever holds one. The enclave's single response reaches
 *   every node, the public RPC calls still go through the plain HTTP client
 *   with identical consensus, and each node derives the same Facts in DON
 *   mode. The trade-off (one enclave's answer instead of a median across
 *   nodes) is in workflows/README.md.
 *
 * What each provider is for:
 *   - Nansen first-funder and related-wallets date the history wallet,
 *     name the exchange it was topped up from and run the sybil check;
 *     Nansen's balance and transactions are the fallbacks for Zerion.
 *   - Zerion reads the Polaris account's Monad testnet history, the history
 *     wallet's exact balances and its trading tenure, and dates a wallet
 *     Nansen has no first funder for.
 *   - Etherscan counts allowlisted-pool liquidations; RPC nonces count sends.
 *
 * In node mode every request carries `cacheSettings`, so one node's paid call
 * is shared by the DON (best effort) and the others read the same bytes,
 * which is what lets identical consensus hold on the evidence. The recipe's
 * requests carry no key: plain mode adds each node's copy here (Etherscan's in
 * its query string, the only place its GET API takes one), and under
 * Confidential HTTP the keys never leave the enclave. Keys are never logged.
 */

import { consensusIdenticalAggregation, cre, type HTTPSendRequester, type NodeRuntime, type Runtime } from "@chainlink/cre-sdk";
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

/** One recipe request in, one reply out: the transport the recipe runs over. */
export type Sender = (spec: RequestSpec) => Reply;

/**
 * Run the recipe over `send`, derive the Facts, and report one observation.
 * The same derivation whichever transport carried the requests; `log` holds
 * every request `send` actually sent.
 */
export function gather(send: Sender, req: Omit<EvidenceRequest, "keys">, log: readonly RequestSpec[], note: (line: string) => void): Observation {
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
  if (issues) note(`provider issues: ${issues.slice(0, 900)}`);
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

/** Node mode: this node gathers the evidence with its own keys; the DON aggregates by field. */
export function observe(nodeRuntime: NodeRuntime<unknown>, req: EvidenceRequest): Observation {
  const log: RequestSpec[] = [];
  return gather(creSender(nodeRuntime, req, log), req, log, (line) => nodeRuntime.log(line));
}

// ------------------------------------------------------------ Confidential HTTP

/**
 * CRE secret ids the enclave resolves as `{{.id}}` placeholders; null leaves
 * a provider out. Zerion's is the ready-made Basic credential,
 * base64("<key>:"), because a placeholder cannot be base64-encoded inside the
 * enclave (scripts/cre.mjs derives it from ZERION_API_KEY for simulation).
 */
export interface ConfidentialSecretIds {
  nansen: string | null;
  zerionBasicAuth: string | null;
  etherscan: string | null;
}

export interface ConfidentialEvidenceRequest extends Omit<EvidenceRequest, "keys"> {
  secretIds: ConfidentialSecretIds;
}

/** The request as Chainlink's Confidential HTTP capability takes it (its JSON shape). */
export interface ConfidentialRequest {
  vaultDonSecrets: Array<{ key: string }>;
  request: {
    url: string;
    method: string;
    multiHeaders: Record<string, { values: string[] }>;
    bodyString?: string;
    timeout: string;
    encryptOutput: false;
  };
}

/** The Vault DON secret id a provider's key is templated from, or null when none is configured. */
function secretIdFor(provider: RequestSpec["provider"], ids: ConfidentialSecretIds): string | null {
  if (provider === "nansen") return ids.nansen;
  if (provider === "zerion") return ids.zerionBasicAuth;
  if (provider === "etherscan") return ids.etherscan;
  return null;
}

/**
 * A paid request with its key as an enclave placeholder, never a value:
 *
 * - Nansen: `apikey: {{.NANSEN_API_KEY}}` header, the JSON body as is.
 * - Zerion: `Authorization: Basic {{.ZERION_BASIC_AUTH}}`.
 * - Etherscan: its key rides only in the query string, and the enclave
 *   resolves placeholders in headers and a POST body, not in the URL
 *   (chainlink core/capabilities/fakes/confidential_http_action.go, the
 *   simulator's implementation). So the request becomes a POST with the
 *   non-secret parameters still in the URL and `apikey={{.ETHERSCAN_API_KEY}}`
 *   as the form body; Etherscan reads a key from a POST form body (checked on
 *   28 Sep 2026 with an invalid key: the same "Invalid API Key (#err2)" as in
 *   the query string).
 *
 * The recipe's requests carry only addresses, dates and numbers. A request
 * that already contains `{{` is refused rather than templated, so no input
 * can ever name a secret.
 */
export function confidentialRequest(spec: RequestSpec, secretId: string): ConfidentialRequest {
  const parts = [spec.url, spec.body ?? "", ...Object.keys(spec.headers), ...Object.values(spec.headers)];
  if (parts.some((p) => p.includes("{{"))) {
    throw new Error(`${spec.provider}.${spec.endpoint}: refusing to template a request that already contains "{{"`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretId)) throw new Error(`secret id "${secretId}" cannot be a template placeholder`);
  const placeholder = `{{.${secretId}}}`;
  const headers: Record<string, string> = { ...spec.headers };
  let method: string = spec.method;
  let body = spec.body;
  if (spec.provider === "nansen") {
    headers.apikey = placeholder;
    if (body !== undefined) headers["content-type"] = "application/json";
  } else if (spec.provider === "zerion") {
    headers.authorization = `Basic ${placeholder}`;
  } else if (spec.provider === "etherscan") {
    if (body !== undefined) throw new Error("etherscan requests carry no body");
    method = "POST";
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = `apikey=${placeholder}`;
  } else {
    throw new Error(`${spec.provider} requests are public: they never go through Confidential HTTP`);
  }
  return {
    vaultDonSecrets: [{ key: secretId }],
    request: {
      url: spec.url,
      method,
      multiHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, { values: [v] }])),
      ...(body !== undefined ? { bodyString: body } : {}),
      // Confidential HTTP's ceiling (docs.chain.link, "Making requests").
      timeout: "10s",
      // The report needs the facts in the clear, so the response is not encrypted.
      encryptOutput: false,
    },
  };
}

function replyFrom(statusCode: number, text: string): Reply {
  let body: unknown = text;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    // not JSON: the recipe's parsers report a parse error for it
  }
  return { ok: true, status: statusCode, body };
}

const failed = (spec: RequestSpec, e: unknown): Reply => ({
  ok: false,
  code: "network_error",
  retryable: true,
  retryAfterMs: null,
  message: `${spec.provider}.${spec.endpoint}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
});

/** Node mode, inside the DON-mode HTTP call below: send one public request, pack the answer as `<status>\n<body>`. */
function sendPublic(requester: HTTPSendRequester, spec: RequestSpec, maxAgeSeconds: number): string {
  try {
    const headers: Record<string, string> = { ...spec.headers };
    if (spec.body !== undefined) headers["content-type"] = "application/json";
    const res = requester
      .sendRequest({
        url: spec.url,
        method: spec.method,
        ...(spec.body !== undefined ? { body: base64Utf8(spec.body) } : {}),
        multiHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, { values: [v] }])),
        timeout: "10s",
        cacheSettings: { store: true, maxAge: `${maxAgeSeconds}s` },
      })
      .result();
    return `${res.statusCode}\n${new TextDecoder().decode(res.body)}`;
  } catch (e) {
    return `ERR\n${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
  }
}

/**
 * The recipe's sender in DON mode: paid providers through Confidential HTTP,
 * public RPCs through the HTTP client with identical consensus (the response
 * cache usually has every node agree on one node's bytes). One budget covers
 * both, as in node mode.
 */
export function confidentialSender(runtime: Runtime<unknown>, req: ConfidentialEvidenceRequest, log: RequestSpec[] = []): Sender {
  const confidential = new cre.capabilities.ConfidentialHTTPClient();
  const http = new cre.capabilities.HTTPClient();
  return (spec) => {
    const secretId = secretIdFor(spec.provider, req.secretIds);
    if (spec.provider !== "rpc" && !secretId) {
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
    if (spec.provider === "rpc") {
      log.push(spec);
      const packed = http
        .sendRequest(runtime, sendPublic, consensusIdenticalAggregation<string>().withDefault("ERR\nno consensus"))(spec, req.cacheMaxAgeSeconds)
        .result();
      const cut = packed.indexOf("\n");
      const head = cut < 0 ? packed : packed.slice(0, cut);
      const rest = cut < 0 ? "" : packed.slice(cut + 1);
      if (!/^\d+$/.test(head)) return failed(spec, rest || head);
      return replyFrom(Number(head), rest);
    }
    let request: ConfidentialRequest;
    try {
      request = confidentialRequest(spec, secretId!);
    } catch (e) {
      return { ok: false, code: "invalid_request", retryable: false, retryAfterMs: null, message: e instanceof Error ? e.message : String(e) };
    }
    log.push(spec);
    try {
      const res = confidential.sendRequest(runtime, request).result();
      return replyFrom(res.statusCode, new TextDecoder().decode(res.body));
    } catch (e) {
      return failed(spec, e);
    }
  };
}

/** DON mode: the paid calls once, from the enclave; every node derives the same Facts. */
export function observeConfidential(runtime: Runtime<unknown>, req: ConfidentialEvidenceRequest): Observation {
  const log: RequestSpec[] = [];
  return gather(confidentialSender(runtime, req, log), req, log, (line) => runtime.log(line));
}
