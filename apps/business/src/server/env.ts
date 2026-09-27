import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

/**
 * Server configuration, read once from the environment.
 *
 * Nothing here is sent to a browser. Every value has a safe default for local
 * development; production refuses to start without the ones that protect
 * money or keys (see `assertProductionReady`).
 */

export type Deployment = {
  network: string;
  chainId: number;
  contracts: Record<string, { address: Address; abi?: string; kind?: string } | undefined>;
  config?: { minInterval?: number; minPeriod?: number; feeBps?: number; interestRateBps?: number; graceSeconds?: number };
  eip712?: Record<string, { domain: { name?: string; version?: string; chainId?: number; verifyingContract?: Address } } | undefined>;
  demo?: { merchant?: Address; merchantName?: string; merchantPrivateKey?: Hex };
};

export type ContractAddresses = {
  stablecoin: Address;
  checkout: Address;
  payments: Address;
  send: Address;
  loanEngine: Address;
  registry: Address;
  scoreManager: Address;
  collections: Address | null;
  underwriting: Address | null;
};

export type ChainConfig = {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  contracts: ContractAddresses;
  /** The stablecoin's EIP-712 name and version (real AUSD: "Agora Dollar", "1"). */
  stablecoinDomain: { name: string; version: string };
  /** Shortest instalment interval the loan engine accepts, in seconds. */
  minIntervalSeconds: number;
  minPeriodSeconds: number;
  feeBps: number;
  local: boolean;
};

export type RelayerConfig =
  | { mode: "off"; reason: string }
  | { mode: "local"; privateKey: Hex }
  | { mode: "privy"; walletId: string; address: Address; authorizationKey: string };

export type ActivatorConfig =
  | { mode: "off" }
  | { mode: "local"; privateKey: Hex }
  | { mode: "privy"; walletId: string; address: Address; authorizationKey: string };

export type ServerConfig = {
  production: boolean;
  chain: ChainConfig | null;
  /** Why the chain isn't configured, for the health route and the setup screen. */
  chainProblem: string | null;
  relayer: RelayerConfig;
  activator: ActivatorConfig;
  /** Per-merchant Pay in 4 cap set on activation, in AUSD base units. */
  activationCapUnits: bigint;
  payoutSigner: { signerId: string; authorizationKey: string } | null;
  privyDisabled: boolean;
  keyPepper: string | undefined;
  dbUrl: string;
  /**
   * The hosted checkout: session URLs are `${checkoutOrigin}/pay/${id}`.
   * Null in production until POLARIS_CHECKOUT_ORIGIN is set: links and
   * sessions don't go live on a guessed host.
   */
  checkoutOrigin: string | null;
  /** This server's own public URL; null in production until POLARIS_PUBLIC_URL is set. */
  publicUrl: string | null;
  /** Origins allowed to call /api/relay and /api/public from a browser. */
  appOrigins: string[];
  cronSecret: string | null;
  webhooks: { allowPrivate: boolean; timeoutMs: number };
  sessionTtlSeconds: number;
  payIn4: { installments: number; intervalSeconds: number; minCents: number; maxCents: number };
  receiptTimeoutMs: number;
  /** Background loops (webhooks, chain sync, payouts) in this process. */
  workers: boolean;
  trustProxy: boolean;
};

const DEFAULT_RPC: Record<number, string> = {
  10143: "https://testnet-rpc.monad.xyz",
  143: "https://rpc.monad.xyz",
  31337: "http://127.0.0.1:8545",
};
const DEFAULT_EXPLORER: Record<number, string> = {
  10143: "https://testnet.monadvision.com",
  143: "https://monadvision.com",
  31337: "http://localhost:8545",
};
const CHAIN_NAME: Record<number, string> = { 10143: "Monad Testnet", 143: "Monad", 31337: "Local Hardhat" };

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function flag(name: string, fallback = false): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function int(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
  return Math.floor(n);
}

function hexKey(name: string): Hex | undefined {
  const v = env(name);
  if (v === undefined) return undefined;
  const key = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!isHex(key) || key.length !== 66) throw new Error(`${name} must be a 32-byte hex private key`);
  return key;
}

function address(name: string): Address | undefined {
  const v = env(name);
  if (v === undefined) return undefined;
  if (!isAddress(v)) throw new Error(`${name} must be an address`);
  return getAddress(v);
}

/**
 * Where deployment records live, relative to where Next runs (apps/business).
 * Read at runtime, not bundled: the `turbopackIgnore` comments keep Next from
 * tracing the whole repository into the server output.
 */
function deploymentPath(): string | null {
  const file = env("POLARIS_DEPLOYMENT_FILE");
  const cwd = process.cwd();
  if (file) return isAbsolute(file) ? file : resolve(/*turbopackIgnore: true*/ cwd, file);
  const name = env("POLARIS_DEPLOYMENT") ?? "monad-testnet";
  const candidates = [
    join(/*turbopackIgnore: true*/ cwd, "..", "..", "packages", "contracts", "deployments", `${name}.json`),
    join(/*turbopackIgnore: true*/ cwd, "packages", "contracts", "deployments", `${name}.json`),
    join(/*turbopackIgnore: true*/ cwd, "deployments", `${name}.json`),
  ];
  return candidates.find((p) => existsSync(/*turbopackIgnore: true*/ p)) ?? null;
}

export function loadDeployment(): { deployment: Deployment | null; problem: string | null; path: string | null } {
  const path = deploymentPath();
  if (!path) {
    return {
      deployment: null,
      path: null,
      problem: `No deployment record found for ${env("POLARIS_DEPLOYMENT") ?? "monad-testnet"}. Deploy the contracts (pnpm --filter @polarispay/contracts deploy:monad) or set POLARIS_DEPLOYMENT_FILE.`,
    };
  }
  try {
    const deployment = JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")) as Deployment;
    if (!Number.isInteger(deployment.chainId)) throw new Error("chainId missing");
    return { deployment, problem: null, path };
  } catch (error) {
    return { deployment: null, path, problem: `The deployment record at ${path} is unreadable: ${(error as Error).message}` };
  }
}

function contractsFrom(d: Deployment): ContractAddresses {
  const need = (name: string): Address => {
    const a = d.contracts[name]?.address;
    if (!a || !isAddress(a)) throw new Error(`The deployment record has no ${name} address`);
    return getAddress(a);
  };
  const maybe = (name: string): Address | null => {
    const a = d.contracts[name]?.address;
    return a && isAddress(a) ? getAddress(a) : null;
  };
  return {
    stablecoin: need("Stablecoin"),
    checkout: need("PolarisCheckout"),
    payments: need("PolarisPayments"),
    send: need("PolarisSend"),
    loanEngine: need("PolarisLoanEngine"),
    registry: need("MerchantRegistry"),
    scoreManager: need("ScoreManager"),
    collections: maybe("CollectionsReceiver"),
    underwriting: maybe("UnderwritingReceiver"),
  };
}

function chainFrom(d: Deployment): ChainConfig {
  const id = d.chainId;
  const stable = d.eip712?.Stablecoin?.domain;
  return {
    id,
    name: CHAIN_NAME[id] ?? `Chain ${id}`,
    rpcUrl: env("POLARIS_RPC_URL") ?? DEFAULT_RPC[id] ?? "",
    explorerUrl: (env("POLARIS_EXPLORER_URL") ?? DEFAULT_EXPLORER[id] ?? "").replace(/\/+$/, ""),
    contracts: contractsFrom(d),
    stablecoinDomain: { name: stable?.name ?? "Agora Dollar", version: stable?.version ?? "1" },
    minIntervalSeconds: d.config?.minInterval ?? 3600,
    minPeriodSeconds: d.config?.minPeriod ?? 3600,
    feeBps: d.config?.feeBps ?? 50,
    local: id === 31337 || id === 1337,
  };
}

function relayerFrom(chain: ChainConfig | null): RelayerConfig {
  const mode = (env("RELAYER_MODE") ?? (env("PRIVY_RELAYER_WALLET_ID") ? "privy" : "off")).toLowerCase();
  if (!chain) return { mode: "off", reason: "No chain is configured." };
  if (mode === "off") return { mode: "off", reason: "RELAYER_MODE is off. Set it to privy (production) or local (a Hardhat node)." };
  if (mode === "local") {
    if (chain.id === 143) throw new Error("RELAYER_MODE=local is never allowed on Monad mainnet: use the Privy relayer.");
    if (!chain.local && !flag("RELAYER_LOCAL_ALLOW_TESTNET")) {
      throw new Error(
        "RELAYER_MODE=local signs with a raw key and is for a local node. On Monad testnet use RELAYER_MODE=privy, or set RELAYER_LOCAL_ALLOW_TESTNET=1 knowingly.",
      );
    }
    const privateKey = hexKey("RELAYER_PRIVATE_KEY");
    if (!privateKey) throw new Error("RELAYER_MODE=local needs RELAYER_PRIVATE_KEY.");
    return { mode: "local", privateKey };
  }
  if (mode === "privy") {
    const walletId = env("PRIVY_RELAYER_WALLET_ID");
    const addr = address("PRIVY_RELAYER_ADDRESS");
    const authorizationKey = env("PRIVY_RELAYER_AUTH_KEY");
    if (!walletId || !addr || !authorizationKey) {
      throw new Error(
        "RELAYER_MODE=privy needs PRIVY_RELAYER_WALLET_ID, PRIVY_RELAYER_ADDRESS and PRIVY_RELAYER_AUTH_KEY (run scripts/privy/setup-relayer.mjs).",
      );
    }
    return { mode: "privy", walletId, address: addr, authorizationKey };
  }
  throw new Error(`RELAYER_MODE must be off, local or privy; got ${JSON.stringify(mode)}`);
}

function activatorFrom(chain: ChainConfig | null): ActivatorConfig {
  const mode = (env("REGISTRY_ACTIVATOR") ?? "off").toLowerCase();
  if (!chain || mode === "off") return { mode: "off" };
  if (mode === "local") {
    if (!chain.local) throw new Error("REGISTRY_ACTIVATOR=local is for a local node only.");
    const privateKey = hexKey("REGISTRY_OWNER_PRIVATE_KEY");
    if (!privateKey) throw new Error("REGISTRY_ACTIVATOR=local needs REGISTRY_OWNER_PRIVATE_KEY.");
    return { mode: "local", privateKey };
  }
  if (mode === "privy") {
    const walletId = env("PRIVY_REGISTRY_WALLET_ID");
    const addr = address("PRIVY_REGISTRY_ADDRESS");
    const authorizationKey = env("PRIVY_REGISTRY_AUTH_KEY");
    if (!walletId || !addr || !authorizationKey) {
      throw new Error("REGISTRY_ACTIVATOR=privy needs PRIVY_REGISTRY_WALLET_ID, PRIVY_REGISTRY_ADDRESS and PRIVY_REGISTRY_AUTH_KEY.");
    }
    return { mode: "privy", walletId, address: addr, authorizationKey };
  }
  throw new Error(`REGISTRY_ACTIVATOR must be off, local or privy; got ${JSON.stringify(mode)}`);
}

function origin(value: string, name: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be a URL, got ${JSON.stringify(value)}`);
  }
}

function build(): ServerConfig {
  const production = process.env.NODE_ENV === "production";
  const { deployment, problem } = loadDeployment();
  let chain: ChainConfig | null = null;
  let chainProblem = problem;
  if (deployment) {
    try {
      chain = chainFrom(deployment);
      if (!chain.rpcUrl) {
        chainProblem = `No RPC for chain ${chain.id}: set POLARIS_RPC_URL.`;
        chain = null;
      }
    } catch (error) {
      chainProblem = (error as Error).message;
    }
  }

  // Development defaults to the local apps; production has none, so a
  // missing setting is reported (productionProblems) instead of handing
  // buyers, or the MerchantRegistry, a host that doesn't exist.
  const checkoutRaw = env("POLARIS_CHECKOUT_ORIGIN") ?? (production ? null : "http://localhost:3000");
  const publicRaw = env("POLARIS_PUBLIC_URL") ?? (production ? null : "http://localhost:3100");
  const checkoutOrigin = checkoutRaw ? origin(checkoutRaw, "POLARIS_CHECKOUT_ORIGIN") : null;
  const publicUrl = publicRaw ? origin(publicRaw, "POLARIS_PUBLIC_URL") : null;
  const extraOrigins = (env("POLARIS_APP_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => origin(s, "POLARIS_APP_ORIGINS"));
  const appOrigins = [
    ...new Set([...(checkoutOrigin ? [checkoutOrigin] : []), ...extraOrigins, ...(production ? [] : ["http://localhost:3000"])]),
  ];

  const signerId = env("PRIVY_PAYOUT_SIGNER_ID") ?? env("NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID");
  const signerKey = env("PRIVY_PAYOUT_SIGNER_KEY");

  const payIn4Interval = int("PAY_IN_4_INTERVAL_SECONDS", 7 * 24 * 3600);

  return {
    production,
    chain,
    chainProblem,
    relayer: relayerFrom(chain),
    activator: activatorFrom(chain),
    activationCapUnits: BigInt(int("MERCHANT_ACTIVATION_CAP_USD", 1_000)) * 1_000_000n,
    payoutSigner: signerId && signerKey ? { signerId, authorizationKey: signerKey } : null,
    privyDisabled: flag("POLARIS_DISABLE_PRIVY"),
    keyPepper: env("POLARIS_KEY_PEPPER"),
    dbUrl: env("POLARIS_DB_URL") ?? `sqlite:${join(/*turbopackIgnore: true*/ process.cwd(), ".data", "polaris.db")}`,
    checkoutOrigin,
    publicUrl,
    appOrigins,
    cronSecret: env("CRON_SECRET") ?? null,
    webhooks: {
      allowPrivate: !production && flag("POLARIS_WEBHOOK_ALLOW_PRIVATE", true),
      timeoutMs: int("POLARIS_WEBHOOK_TIMEOUT_MS", 10_000),
    },
    sessionTtlSeconds: int("POLARIS_SESSION_TTL_SECONDS", 24 * 3600),
    payIn4: {
      installments: 4,
      intervalSeconds: chain ? Math.max(payIn4Interval, chain.minIntervalSeconds) : payIn4Interval,
      minCents: int("PAY_IN_4_MIN_CENTS", 20_00),
      maxCents: int("PAY_IN_4_MAX_CENTS", 1_000_00),
    },
    receiptTimeoutMs: int("RELAYER_RECEIPT_TIMEOUT_MS", 15_000),
    workers: flag("POLARIS_WORKERS", !production),
    trustProxy: flag("POLARIS_TRUST_PROXY"),
  };
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  cached ??= build();
  return cached;
}

/** Tests change the environment between cases. */
export function resetConfig(): void {
  cached = null;
}

/** What production needs before it takes money: logged at startup (instrumentation.ts); the health route reports only whether there is any. */
export function productionProblems(config = getConfig()): string[] {
  if (!config.production) return [];
  const problems: string[] = [];
  if (!config.keyPepper) problems.push("POLARIS_KEY_PEPPER is not set: secret keys would be stored as plain SHA-256.");
  if (!config.cronSecret) problems.push("CRON_SECRET is not set: the cron routes are closed.");
  if (config.relayer.mode === "local") problems.push("The relayer signs with a raw key.");
  if (!config.checkoutOrigin) problems.push("POLARIS_CHECKOUT_ORIGIN is not set: payment links and checkout sessions have nowhere to send buyers.");
  if (!config.publicUrl) problems.push("POLARIS_PUBLIC_URL is not set: merchants can't register on Monad (it goes in their registry metadata).");
  if (!config.trustProxy) problems.push("POLARIS_TRUST_PROXY is not set: behind a proxy every visitor shares one rate-limit bucket.");
  return problems;
}

/** The hosted checkout's URL for a link or session id, or null while no checkout origin is configured. */
export function checkoutUrl(id: string, config = getConfig()): string | null {
  return config.checkoutOrigin ? `${config.checkoutOrigin}/pay/${id}` : null;
}

export function explorerTxUrl(hash: string, config = getConfig()): string | null {
  return config.chain?.explorerUrl ? `${config.chain.explorerUrl}/tx/${hash}` : null;
}
