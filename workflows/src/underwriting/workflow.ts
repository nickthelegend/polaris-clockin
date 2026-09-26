/**
 * `polaris-underwrite`: opens a buyer's first credit line, on an HTTP trigger.
 *
 * Fired when a buyer asks for Pay in 4 (plan §3.3, §5.5):
 *
 *   1. DON mode, no network: parse the payload; verify the Bring-your-history
 *      proof (the wallet's own signature, fresh) before spending anything.
 *   2. EVM reads: refuse a buyer ScoreManager has already underwritten and a
 *      history wallet already backing someone else, so no Nansen credit is
 *      spent on a report the chain would refuse; read the account's dollars
 *      (AUSD balanceOf) so the account costs one HTTP call, not three.
 *   3. Node mode: each node drives @polarispay/underwriting's recipe through
 *      CRE's HTTP client (Nansen first, Zerion as the fallback, Etherscan and
 *      RPC for the rest), derives the Facts with its pure core, and the DON
 *      agrees field by field: counts by median, verdicts by identical.
 *   4. Only a final set of facts is reported. The report carries facts, never
 *      a score: ScoreManager computes the score on chain, caps the opening
 *      line at $1,000 and refuses evidence older than 15 minutes.
 *   5. The receipt says whether ScoreManager applied it (`UnderwritingApplied`
 *      with the score) or refused it, and why.
 */

import {
  ConsensusAggregationByFields,
  cre,
  type HTTPPayload,
  identical,
  ignore,
  median,
  type Runtime,
} from "@chainlink/cre-sdk";
// Aave V3 pools by chain: the config names chains, the package holds the allowlisted pools.
import { LIQUIDATION_POOLS as LIQUIDATION_POOLS_BY_CHAIN, scoreFromFacts } from "@polarispay/underwriting/core";
import { type Address, decodeErrorResult, type Hex, parseAbi, zeroAddress } from "viem";
import { z } from "zod";
import { address, callbackSchema, chainSelectorName, gasSchema } from "../shared/config.ts";
import {
  decodeLogsFrom,
  deliveredTo,
  estimateDelivery,
  estimateOnReport,
  evmClientFor,
  gasLimitFor,
  nowSeconds,
  readContract,
  readReceipt,
  signReport,
  submitReport,
} from "../shared/evm.ts";
import { optionalSecret, postSignedCallback } from "../shared/http.ts";
import { type Observation, observe, type ProviderKeys } from "./evidence.ts";
import { verifyLinkProof } from "./link.ts";
import { parseUnderwritingPayload } from "./payload.ts";
import { encodeUnderwritingReport } from "./report.ts";

export const configSchema = z.object({
  chainSelectorName,
  receiver: address("UnderwritingReceiver"),
  scoreManager: address("ScoreManager"),
  forwarder: address("forwarder"),
  /** The stablecoins whose balance counts as the account's dollars (6 decimals). */
  stablecoins: z.array(address("stablecoin")).min(1).max(4),
  /**
   * EVM addresses whose signed requests may fire the trigger once deployed
   * (the Polaris API's signer). Simulation accepts none.
   */
  authorizedKeys: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/, "authorized keys are 20-byte EVM addresses"), {
    invalid_type_error:
      "authorizedKeys is not set: list the address the Polaris API signs trigger requests with ([] works only in simulation)",
  }),
  /** CRE secret ids of the provider keys; null leaves a provider out. */
  secrets: z.object({
    nansen: z.string().min(1).nullable(),
    zerion: z.string().min(1).nullable(),
    etherscan: z.string().min(1).nullable(),
  }),
  recipe: z.object({
    /** Zerion's chain id for the Polaris account's network (`monad-test-v2`). */
    accountZerionChain: z.string().min(1),
    accountChainId: z.number().int().positive(),
    /** JSON-RPC endpoints whose nonces count a history wallet's sends. */
    historyRpcUrls: z.array(z.string().url()).max(4),
    /** Chain ids whose allowlisted Aave pools count liquidations (one call each). */
    liquidationChainIds: z.array(z.number().int().positive()).max(3),
    /** Spend 100 Nansen credits on labels for the risk screen. */
    useNansenLabels: z.boolean(),
  }),
  /** HTTP calls one execution may make; CRE's quota is 15. */
  httpBudget: z.number().int().min(1).max(15),
  /** Seconds one node's response is shared with the others (CRE caps at 600). */
  cacheMaxAgeSeconds: z.number().int().min(0).max(600),
  /** Underwrite on partial data instead of asking the app to retry. */
  allowPartial: z.boolean(),
  gas: gasSchema,
  callback: callbackSchema,
});
export type UnderwritingConfig = z.infer<typeof configSchema>;

const SCORE_ABI = parseAbi([
  "struct Profile { uint16 score; uint32 onTimePayments; uint32 latePayments; uint32 liquidations; uint64 firstSeenAt; bool initialized; bool declined; bool underwritten; }",
  "function profileOf(address user) view returns (Profile)",
  "function requireUnderwriting() view returns (bool)",
]);
const RECEIVER_ABI = parseAbi([
  "function linkedUserOf(address wallet) view returns (address)",
  "function simulationTransmitter() view returns (address)",
  "event UnderwritingApplied(address indexed user, address indexed linkedWallet, uint16 score)",
  "event UnderwritingRefused(address indexed user, address indexed linkedWallet, bytes reason)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const REFUSAL_ERRORS = parseAbi([
  "error StaleEvidence()",
  "error AlreadyHasRecord()",
  "error WalletAlreadyLinked(address wallet, address user)",
  "error InvalidUser(address user)",
  "error NotUnderwriter()",
]);

export interface UnderwritingResult {
  status: "applied" | "refused" | "incomplete" | "skipped" | "rejected" | "dry-run";
  user: Address;
  linkedWallet: Address | null;
  reason: string | null;
  /** The mirror's score for the attested facts; the chain's is in `onChainScore`. */
  expectedScore: number | null;
  onChainScore: number | null;
  missing: string[];
  httpCalls: number | null;
  txHash: string | null;
  gasLimit: string | null;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function decodeRefusal(reason: Hex): string {
  try {
    const d = decodeErrorResult({ abi: REFUSAL_ERRORS, data: reason });
    return d.args && d.args.length > 0 ? `${d.errorName}(${d.args.join(", ")})` : d.errorName;
  } catch {
    return `unknown(${reason.slice(0, 10)})`;
  }
}

export function onHttpTrigger(runtime: Runtime<UnderwritingConfig>, payload: HTTPPayload): string {
  const cfg = runtime.config;
  const input = parseUnderwritingPayload(payload.input);
  const user = input.user;
  const wallet = input.linked?.wallet ?? null;
  const now = nowSeconds(runtime);
  const result: UnderwritingResult = {
    status: "rejected",
    user,
    linkedWallet: wallet,
    reason: null,
    expectedScore: null,
    onChainScore: null,
    missing: [],
    httpCalls: null,
    txHash: null,
    gasLimit: null,
  };
  const done = (patch: Partial<UnderwritingResult>) => {
    const out = { ...result, ...patch };
    runtime.log(`underwriting ${user}: ${out.status}${out.reason ? ` (${out.reason})` : ""}`);
    return JSON.stringify(out);
  };

  // 1. The history wallet's proof, before any read or paid call.
  if (input.linked) {
    const check = verifyLinkProof({ account: user, ...input.linked }, now);
    if (!check.ok) return done({ status: "rejected", reason: check.reason });
  }

  // 2. What the chain would refuse anyway, and the account's dollars.
  const evm = evmClientFor(cfg.chainSelectorName);
  const profile = readContract(runtime, evm, {
    address: cfg.scoreManager,
    abi: SCORE_ABI,
    functionName: "profileOf",
    args: [user],
  }) as { initialized: boolean; underwritten: boolean; liquidations: number };
  if (profile.initialized) {
    const requireUnderwriting = readContract(runtime, evm, {
      address: cfg.scoreManager,
      abi: SCORE_ABI,
      functionName: "requireUnderwriting",
    }) as boolean;
    if (profile.underwritten || !requireUnderwriting || profile.liquidations !== 0) {
      return done({ status: "skipped", reason: "ScoreManager already holds a record for this account (AlreadyHasRecord)" });
    }
  }
  if (wallet) {
    const holder = readContract(runtime, evm, {
      address: cfg.receiver,
      abi: RECEIVER_ABI,
      functionName: "linkedUserOf",
      args: [wallet],
    }) as Address;
    if (holder !== zeroAddress && holder.toLowerCase() !== user.toLowerCase()) {
      return done({ status: "rejected", reason: `this history wallet already backs ${holder} (WalletAlreadyLinked)` });
    }
  }
  let balance = 0n;
  for (const token of cfg.stablecoins) {
    balance += readContract(runtime, evm, { address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }) as bigint;
  }
  const accountBalance = Number(balance > MAX_SAFE ? MAX_SAFE : balance);

  // 3. The evidence, gathered by every node and agreed field by field.
  const keys: ProviderKeys = {
    nansen: optionalSecret(runtime, cfg.secrets.nansen),
    zerion: optionalSecret(runtime, cfg.secrets.zerion),
    etherscan: optionalSecret(runtime, cfg.secrets.etherscan),
  };
  const liquidationPools: Record<number, readonly Address[]> = Object.fromEntries(
    cfg.recipe.liquidationChainIds.map((id) => [id, LIQUIDATION_POOLS_BY_CHAIN[id] ?? []]),
  );
  const observation = runtime
    .runInNodeMode(
      observe,
      ConsensusAggregationByFields<Observation>({
        final: identical,
        missing: identical,
        walletAgeDays: median,
        txCount: median,
        stableBalance: median,
        defiTenureDays: median,
        priorLiquidations: median,
        relatedWallets: median,
        exchangeFunded: identical,
        score: median,
        httpCalls: median,
        // Which provider hiccupped can differ by node; each node logs its own.
        issues: ignore,
      }),
    )({
      user,
      wallet,
      now,
      accountBalance,
      keys,
      recipe: {
        accountZerionChain: cfg.recipe.accountZerionChain,
        accountChainId: cfg.recipe.accountChainId,
        historyRpcUrls: cfg.recipe.historyRpcUrls,
        liquidationPools,
        useNansenLabels: cfg.recipe.useNansenLabels,
      },
      httpBudget: cfg.httpBudget,
      cacheMaxAgeSeconds: cfg.cacheMaxAgeSeconds,
      allowPartial: cfg.allowPartial,
    })
    .result();

  const facts = {
    walletAgeDays: Math.floor(observation.walletAgeDays),
    txCount: Math.floor(observation.txCount),
    stableBalance: observation.stableBalance,
    defiTenureDays: Math.floor(observation.defiTenureDays),
    priorLiquidations: Math.floor(observation.priorLiquidations),
    relatedWallets: Math.floor(observation.relatedWallets),
    exchangeFunded: observation.exchangeFunded,
    observedAt: BigInt(now),
  };
  const expected = scoreFromFacts(facts);
  const partial: Partial<UnderwritingResult> = {
    expectedScore: expected.score,
    missing: observation.missing ? observation.missing.split(",") : [],
    httpCalls: Math.floor(observation.httpCalls),
  };
  if (!observation.final) {
    // Missing data is never attested as zero: no report, the app retries.
    return done({ ...partial, status: "incomplete", reason: `not final: ${observation.missing}` });
  }

  // 4. Facts, never a score, signed by the DON and written through the forwarder.
  const report = signReport(runtime, encodeUnderwritingReport([{ user, linkedWallet: wallet, facts }]));
  // While simulating, the receiver also requires the transaction's origin to be
  // the simulation transmitter, which an estimate from the forwarder cannot be:
  // estimate the whole delivery from that key instead (one item, so small).
  const transmitter = readContract(runtime, evm, {
    address: cfg.receiver,
    abi: RECEIVER_ABI,
    functionName: "simulationTransmitter",
  }) as Address;
  const target = { forwarder: cfg.forwarder, receiver: cfg.receiver, report };
  const gasLimit =
    transmitter === zeroAddress
      ? gasLimitFor(estimateOnReport(runtime, evm, target), cfg.gas, "receiver")
      : gasLimitFor(estimateDelivery(runtime, evm, { ...target, from: transmitter }), cfg.gas, "delivery");
  const write = submitReport(runtime, evm, { receiver: cfg.receiver, report, gasLimit });
  const written = { ...partial, txHash: write.txHash, gasLimit: gasLimit.toString() };
  if (!write.broadcast) return done({ ...written, status: "dry-run" });

  // 5. What ScoreManager did with it.
  const receipt = readReceipt(runtime, evm, write.txHash);
  if (deliveredTo(receipt, cfg.receiver) === false) {
    throw new Error(`UnderwritingReceiver reverted the report in ${write.txHash} (the forwarder recorded result=false)`);
  }
  let final: UnderwritingResult | null = null;
  for (const ev of decodeLogsFrom(receipt, cfg.receiver, RECEIVER_ABI)) {
    if (String(ev.args.user).toLowerCase() !== user.toLowerCase()) continue;
    if (ev.eventName === "UnderwritingApplied") {
      final = { ...result, ...written, status: "applied", onChainScore: Number(ev.args.score) };
    } else if (ev.eventName === "UnderwritingRefused") {
      final = { ...result, ...written, status: "refused", reason: decodeRefusal(ev.args.reason as Hex) };
    }
  }
  if (!final) throw new Error(`UnderwritingReceiver emitted no outcome for ${user} in ${write.txHash}`);

  if (cfg.callback) {
    const secret = optionalSecret(runtime, cfg.callback.secretId);
    if (secret) {
      postSignedCallback(runtime, {
        url: cfg.callback.url,
        secret,
        payload: {
          id: write.txHash,
          type: final.status === "applied" ? "credit.underwritten" : "credit.refused",
          createdAt: now,
          chain: cfg.chainSelectorName,
          user,
          linkedWallet: wallet,
          score: final.onChainScore,
          reason: final.reason,
          txHash: write.txHash,
        },
      });
    }
  }
  return done(final);
}

export const initWorkflow = (config: UnderwritingConfig) => [
  cre.handler(
    new cre.capabilities.HTTPCapability().trigger({
      authorizedKeys: config.authorizedKeys.map((publicKey) => ({ type: "KEY_TYPE_ECDSA_EVM" as const, publicKey })),
    }),
    onHttpTrigger,
  ),
];
