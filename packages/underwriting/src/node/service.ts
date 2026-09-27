/**
 * The underwriting service: clients from the environment, evidence from the
 * providers, and the pure core's decision.
 *
 *   const uw = Underwriter.fromEnv();
 *   const a = await uw.assess({ account, linked: { wallet, proof }, purchase: 200_000_000n });
 *   a.decision.payIn4.allowed, a.decision.reasons, a.final, a.report
 *
 * Modes: a provider with a key is live, one without reads fixtures.
 * `UNDERWRITING_MODE=fixture` forces fixtures everywhere (tests, demos with no
 * keys); `UNDERWRITING_MODE=live` forces live calls. Public RPCs need no key,
 * so they are live whenever any keyed provider is, and fixtures otherwise, so
 * a fixture persona is never mixed with a real chain's zero balance.
 */

import { verifyMessage } from "viem";
import { FACTS_VERSION, HISTORY_CHAINS, MODEL_VERSION, MONAD_TESTNET } from "../core/constants.ts";
import { unknownSubject } from "../core/evidence.ts";
import { linkMessage, linkProofStaleness } from "../core/link.ts";
import type { Address, DataMode, Hex, SubjectEvidence } from "../core/types.ts";
import { underwrite, type UnderwriteOutcome } from "../core/underwrite.ts";
import { collectAccount, collectLinked, type CollectOptions, type Issue, type Providers } from "./collect.ts";
import { EtherscanClient } from "./etherscan.ts";
import type { ClientOptions } from "./client.ts";
import { NansenClient } from "./nansen.ts";
import { RpcClient } from "./rpc.ts";
import { ZerionClient } from "./zerion.ts";

export interface AssessRequest {
  /** The buyer's Polaris account. */
  account: Address;
  /** A wallet they already use, with its signed proof (core/link.ts). */
  linked?: { wallet: Address; proof?: { issuedAt: number; nonce: string; signature: Hex } | null } | null;
  /** A purchase to quote, 6-decimal base units. */
  purchase?: bigint | null;
  /** What they owe on open plans, 6-decimal base units. */
  activeDebt?: bigint;
  /** Report conservatively instead of asking to retry. See core/facts.ts. */
  allowPartial?: boolean;
}

export interface Assessment extends UnderwriteOutcome {
  /** Unix seconds; also `facts.observedAt`. */
  assessedAt: number;
  /** Where the evidence came from. "fixture" means none of it is live data. */
  dataMode: DataMode | "mixed";
  evidence: { account: SubjectEvidence; linked: SubjectEvidence | null };
  linkProof: { verified: boolean; reason: string | null } | null;
  /** Sources that did not answer, without secrets. */
  issues: Issue[];
  /** When the app should ask again, if the outcome is not final. */
  retryAfterSeconds: number | null;
  /** Nansen credits spent on this assessment, from `x-nansen-credits-used`. */
  credits: { nansen: number };
}

export interface UnderwriterOptions {
  providers: Providers;
  /** Unix seconds. */
  now?: () => number;
  collect?: Omit<CollectOptions, "now">;
  allowPartial?: boolean;
  /** Where Nansen credit headers are counted; set by `fromEnv`. */
  creditMeter?: CreditMeter;
}

/** Counts `x-nansen-credits-used` across requests. */
export class CreditMeter {
  total = 0;
  record(headers: Record<string, string>): void {
    const used = Number(headers["x-nansen-credits-used"] ?? "0");
    if (Number.isFinite(used) && used > 0) this.total += used;
  }
}

export class Underwriter {
  readonly providers: Providers;
  private readonly now: () => number;
  private readonly collect: Omit<CollectOptions, "now">;
  private readonly allowPartial: boolean;
  private readonly meter: CreditMeter | undefined;

  constructor(opts: UnderwriterOptions) {
    this.providers = opts.providers;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.collect = opts.collect ?? {};
    this.allowPartial = opts.allowPartial ?? false;
    this.meter = opts.creditMeter;
  }

  /** Build every client from environment variables. See the README for the list. */
  static fromEnv(env: Record<string, string | undefined> = process.env, overrides: Partial<UnderwriterOptions> = {}): Underwriter {
    const forced = env.UNDERWRITING_MODE === "fixture" || env.UNDERWRITING_MODE === "live" ? env.UNDERWRITING_MODE : undefined;
    const fixturesDir = env.UNDERWRITING_FIXTURES_DIR || undefined;
    const meter = new CreditMeter();
    const base: ClientOptions = { fixturesDir, mode: forced };

    const nansen = new NansenClient({ ...base, apiKey: env.NANSEN_API_KEY, onResponse: (_s, res) => meter.record(res.headers) });
    const zerion = new ZerionClient({ ...base, apiKey: env.ZERION_API_KEY });
    const etherscan = new EtherscanClient({ ...base, apiKey: env.ETHERSCAN_API_KEY });
    const anyLive = [nansen, zerion, etherscan].some((c) => c.mode === "live");
    const rpcMode: DataMode = forced ?? (anyLive ? "live" : "fixture");
    const rpcOpts: ClientOptions = { fixturesDir, mode: rpcMode };
    const accountRpc = new RpcClient(env.MONAD_TESTNET_RPC_URL || MONAD_TESTNET.rpcUrl, MONAD_TESTNET.chainId, rpcOpts);
    const historyRpcs = HISTORY_CHAINS.map((c) => new RpcClient(env[`RPC_URL_${c.chainId}`] || c.rpcUrl, c.chainId, rpcOpts));

    return new Underwriter({
      providers: { nansen, zerion, etherscan, accountRpc, historyRpcs },
      allowPartial: env.UNDERWRITING_ALLOW_PARTIAL === "1",
      collect: { useNansenLabels: env.NANSEN_LABELS === "1" },
      creditMeter: meter,
      ...overrides,
    });
  }

  modes(): Record<"nansen" | "zerion" | "etherscan" | "rpc", DataMode> {
    const p = this.providers;
    return { nansen: p.nansen.mode, zerion: p.zerion.mode, etherscan: p.etherscan.mode, rpc: p.accountRpc.mode };
  }

  /** "live" or "fixture" when every client agrees, else "mixed". */
  configuredMode(): DataMode | "mixed" {
    const modes = new Set(Object.values(this.modes()));
    return modes.size === 1 ? [...modes][0]! : "mixed";
  }

  async assess(req: AssessRequest): Promise<Assessment> {
    const now = this.now();
    const opts: CollectOptions = { ...this.collect, now };
    const creditsBefore = this.meter?.total ?? 0;

    const wallet = req.linked?.wallet ?? null;
    const sameAsAccount = wallet !== null && wallet.toLowerCase() === req.account.toLowerCase();
    const linkedWallet = sameAsAccount ? null : wallet;

    const [account, linked, linkProof] = await Promise.all([
      collectAccount(req.account, this.providers, opts).catch((err: Error) => ({
        evidence: unknownSubject(req.account, "account", err.message),
        issues: [{ subject: "account" as const, source: "polaris.collector", code: "error", retryable: true, retryAfterMs: null, message: err.message }],
      })),
      linkedWallet
        ? collectLinked(linkedWallet, this.providers, opts).catch((err: Error) => ({
            evidence: unknownSubject(linkedWallet, "linked", err.message),
            issues: [{ subject: "linked" as const, source: "polaris.collector", code: "error", retryable: true, retryAfterMs: null, message: err.message }],
          }))
        : Promise.resolve(null),
      linkedWallet ? verifyLinkProof(req.account, linkedWallet, req.linked?.proof ?? null, now) : Promise.resolve(null),
    ]);

    const outcome = underwrite({
      user: req.account,
      observedAt: now,
      account: account.evidence,
      linked: linked?.evidence ?? null,
      linkVerified: linkProof?.verified ?? false,
      activeDebt: req.activeDebt,
      purchase: req.purchase ?? null,
      options: { allowPartial: req.allowPartial ?? this.allowPartial },
    });

    const issues = [...account.issues, ...(linked?.issues ?? [])];
    return {
      ...outcome,
      assessedAt: now,
      dataMode: dataModeOf([account.evidence, linked?.evidence ?? null], this.configuredMode()),
      evidence: { account: account.evidence, linked: linked?.evidence ?? null },
      linkProof,
      issues,
      retryAfterSeconds: outcome.final ? null : retryAfter(issues, outcome.missing),
      credits: { nansen: (this.meter?.total ?? 0) - creditsBefore },
    };
  }
}

/** Check the EIP-191 signature a linked wallet made over `linkMessage`. */
export async function verifyLinkProof(
  account: Address,
  wallet: Address,
  proof: { issuedAt: number; nonce: string; signature: Hex } | null,
  now: number,
): Promise<{ verified: boolean; reason: string | null }> {
  if (!proof) return { verified: false, reason: "no ownership proof" };
  const stale = linkProofStaleness(proof.issuedAt, now);
  if (stale) return { verified: false, reason: `proof ${stale}` };
  try {
    const message = linkMessage({ account, wallet, issuedAt: proof.issuedAt, nonce: proof.nonce });
    const ok = await verifyMessage({ address: wallet, message, signature: proof.signature });
    return ok ? { verified: true, reason: null } : { verified: false, reason: "signature is not from this wallet" };
  } catch (err) {
    return { verified: false, reason: `unreadable proof: ${(err as Error).message.split("\n")[0]}` };
  }
}

function dataModeOf(subjects: Array<SubjectEvidence | null>, whenNothingAnswered: DataMode | "mixed"): DataMode | "mixed" {
  const modes = new Set<DataMode>();
  for (const s of subjects) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (k === "address" || k === "role") continue;
      const mode = (v as { mode?: DataMode }).mode;
      if (mode) modes.add(mode);
    }
  }
  if (modes.size === 0) return whenNothingAnswered;
  if (modes.size === 1) return [...modes][0]!;
  return "mixed";
}

function retryAfter(issues: Issue[], missing: string[]): number | null {
  if (missing.length === 1 && missing[0] === "linked.ownership") return null; // nothing to wait for; the buyer must sign
  const waits = issues.map((i) => i.retryAfterMs ?? 0);
  const longest = Math.max(0, ...waits);
  return Math.max(30, Math.ceil(longest / 1000));
}

/** The facts' version and the model version this service speaks. */
export const SERVICE_VERSION = { facts: FACTS_VERSION, model: MODEL_VERSION } as const;
