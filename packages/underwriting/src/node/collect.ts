/**
 * Gather evidence for one underwriting in Node, by driving the core's recipe
 * (core/recipe.ts) with the provider clients.
 *
 * The recipe decides what to ask and how to read each answer, including every
 * fallback, and is the same code the CRE workflow runs. This module only sends:
 * each batch concurrently, through the client for its provider, which adds the
 * key, retries, rate-limits and caches. It then stamps each piece of evidence
 * with whether it came from a live API or a fixture.
 */

import type { RequestSpec } from "../core/providers/common.ts";
import {
  accountRecipe,
  linkedRecipe,
  runAsync,
  type Collected,
  type Issue,
  type RecipeOptions,
  type Reply,
} from "../core/recipe.ts";
import type { Address, DataMode, Evidence, SubjectEvidence } from "../core/types.ts";
import type { EtherscanClient } from "./etherscan.ts";
import { ProviderError } from "./http.ts";
import type { NansenClient } from "./nansen.ts";
import type { RpcClient } from "./rpc.ts";
import type { ZerionClient } from "./zerion.ts";

export type { Collected, Issue };

export interface Providers {
  nansen: NansenClient;
  zerion: ZerionClient;
  etherscan: EtherscanClient;
  /** Monad testnet, where Polaris accounts live. */
  accountRpc: RpcClient;
  /** Chains whose nonces count as a linked wallet's sent transactions. */
  historyRpcs: RpcClient[];
}

/** Recipe options; the RPC endpoints come from the providers. */
export type CollectOptions = Omit<RecipeOptions, "accountRpcUrl" | "historyRpcUrls">;

/** A sender for `runAsync`: each request through its provider's client, as a Reply. */
export function sender(p: Providers): (spec: RequestSpec) => Promise<Reply> {
  const rpcByUrl = new Map([p.accountRpc, ...p.historyRpcs].map((c) => [c.url, c]));
  return async (spec) => {
    const client =
      spec.provider === "nansen" ? p.nansen : spec.provider === "zerion" ? p.zerion : spec.provider === "etherscan" ? p.etherscan : (rpcByUrl.get(spec.url) ?? p.accountRpc);
    try {
      const res = await client.execute(spec);
      let body: unknown;
      try {
        body = JSON.parse(res.body);
      } catch {
        return { ok: false, code: "parse_error", retryable: false, retryAfterMs: null, message: `${spec.provider}.${spec.endpoint}: response is not JSON` };
      }
      return { ok: true, status: res.status, body, headers: res.headers };
    } catch (err) {
      if (err instanceof ProviderError) {
        return { ok: false, code: err.code, retryable: err.retryable, retryAfterMs: err.retryAfterMs, message: err.message };
      }
      return { ok: false, code: "error", retryable: true, retryAfterMs: null, message: `${spec.provider}.${spec.endpoint}: ${(err as Error).message}` };
    }
  };
}

function stampModes(e: SubjectEvidence, p: Providers): SubjectEvidence {
  const modeOf: Record<string, DataMode> = { nansen: p.nansen.mode, zerion: p.zerion.mode, etherscan: p.etherscan.mode, rpc: p.accountRpc.mode };
  const out: Record<string, unknown> = { address: e.address, role: e.role };
  for (const [k, v] of Object.entries(e)) {
    if (k === "address" || k === "role") continue;
    const ev = v as Evidence<unknown>;
    const mode = modeOf[ev.source.split(".")[0]!];
    out[k] = mode && ev.status !== "missing" ? { ...ev, mode } : ev;
  }
  return out as unknown as SubjectEvidence;
}

function recipeOptions(p: Providers, o: CollectOptions): RecipeOptions {
  return { ...o, accountRpcUrl: p.accountRpc.url, historyRpcUrls: p.historyRpcs.map((c) => c.url) };
}

export async function collectAccount(address: Address, p: Providers, o: CollectOptions): Promise<Collected> {
  const c = await runAsync(accountRecipe(address, recipeOptions(p, o)), sender(p));
  return { issues: c.issues, evidence: stampModes(c.evidence, p) };
}

export async function collectLinked(address: Address, p: Providers, o: CollectOptions): Promise<Collected> {
  const c = await runAsync(linkedRecipe(address, recipeOptions(p, o)), sender(p));
  return { issues: c.issues, evidence: stampModes(c.evidence, p) };
}
