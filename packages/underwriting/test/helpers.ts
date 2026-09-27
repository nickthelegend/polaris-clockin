/**
 * Shared test setup: fixture-backed providers with instant retries, and
 * transports that fail on cue.
 */

import { HISTORY_CHAINS, MONAD_TESTNET } from "../src/core/constants.ts";
import type { Address } from "../src/core/types.ts";
import type { Providers } from "../src/node/collect.ts";
import { EtherscanClient } from "../src/node/etherscan.ts";
import { fixtureTransport } from "../src/node/fixtures.ts";
import type { Clock, HttpRequest, HttpResponse, HttpTransport } from "../src/node/http.ts";
import { NansenClient } from "../src/node/nansen.ts";
import { RpcClient } from "../src/node/rpc.ts";
import { ZerionClient } from "../src/node/zerion.ts";

/** Fixtures are dated back from 2026-09-26; tests read them at noon that day. */
export const NOW = Date.UTC(2026, 8, 26, 12, 0, 0) / 1000;

export const ACCOUNT = {
  fresh: "0xacc0000000000000000000000000000000000001",
  regular: "0xacc0000000000000000000000000000000000002",
  zerionBlind: "0xacc0000000000000000000000000000000000003",
} as const satisfies Record<string, Address>;

export const LINKED = {
  strong: "0xb0b0000000000000000000000000000000000001",
  modest: "0xb0b0000000000000000000000000000000000002",
  liquidated: "0xb0b0000000000000000000000000000000000003",
  sybil: "0xb0b0000000000000000000000000000000000004",
  tainted: "0xb0b0000000000000000000000000000000000005",
  noFunder: "0xb0b0000000000000000000000000000000000006",
  infra: "0xb0b0000000000000000000000000000000000007",
  exchangeWallet: "0xb0b0000000000000000000000000000000000008",
} as const satisfies Record<string, Address>;

/** A clock whose sleeps return at once and are recorded. */
export function instantClock(start = NOW * 1000): Clock & { slept: number[]; t: number } {
  const c = {
    t: start,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

export type Rule = {
  /** Which requests: a provider host fragment and optionally a path fragment. */
  match: (req: HttpRequest) => boolean;
  /** What to do: a canned response, or throw. `times` limits how often (default: always). */
  respond: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  times?: number;
};

/** Wrap a transport so matching requests get canned responses; the rest pass through. Counts calls. */
export function scripted(inner: HttpTransport, rules: Rule[]): HttpTransport & { calls: HttpRequest[] } {
  const used = rules.map(() => 0);
  const calls: HttpRequest[] = [];
  const t = (async (req: HttpRequest, signal: AbortSignal) => {
    calls.push(req);
    for (const [i, rule] of rules.entries()) {
      if (!rule.match(req)) continue;
      if (rule.times !== undefined && used[i]! >= rule.times) continue;
      used[i]! += 1;
      return rule.respond(req);
    }
    return inner(req, signal);
  }) as HttpTransport & { calls: HttpRequest[] };
  t.calls = calls;
  return t;
}

export const host = (fragment: string, path?: string) => (req: HttpRequest) =>
  req.url.includes(fragment) && (path === undefined || req.url.includes(path));

export const status = (code: number, body: unknown = {}, headers: Record<string, string> = {}): HttpResponse => ({
  status: code,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const networkDown = (): never => {
  throw new TypeError("fetch failed");
};

/** Providers on fixtures, with fast retries and an instant clock. */
export function fixtureProviders(transport?: HttpTransport): Providers & { clock: ReturnType<typeof instantClock>; transport: HttpTransport } {
  const clock = instantClock();
  const t = transport ?? fixtureTransport();
  const opts = { mode: "fixture" as const, transport: t, clock, retry: { attempts: 3, baseDelayMs: 10, timeoutMs: 2_000 }, random: () => 0.5, cacheTtlMs: 0 };
  return {
    clock,
    transport: t,
    nansen: new NansenClient(opts),
    zerion: new ZerionClient(opts),
    etherscan: new EtherscanClient(opts),
    accountRpc: new RpcClient(MONAD_TESTNET.rpcUrl, MONAD_TESTNET.chainId, opts),
    historyRpcs: HISTORY_CHAINS.map((c) => new RpcClient(c.rpcUrl, c.chainId, opts)),
  };
}

/** Words the buyer never sees (plan §2), plus the credit jargon this package could leak. */
export const JARGON =
  /\b(wallets?|address(es)?|seed|passkeys?|sign(ed|ing|ature)?|approv(e|al)|transactions?|gas|MON|AUSD|USDC|tokens?|blockchain|on-?chain|monad|crypto|defi|liquidat\w*|sybil|stablecoins?|nonces?|protocols?|collateral|smart contract|nansen|zerion|etherscan)\b/i;
