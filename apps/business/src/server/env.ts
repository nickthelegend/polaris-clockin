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
  /**
   * What the relayer refuses to spend its MON on, whoever asks:
   * - `minTransferUnits`: the smallest AUSD transfer or send by link it
   *   carries (also a condition in the Privy policy), so moving 0 AUSD
   *   between throwaway keys is not free gas;
   * - `maxGas` and `maxFeePerGasWei`: caps on any one transaction, which the
   *   Privy policy can't express.
   */
  relayerLimits: { minTransferUnits: bigint; maxGas: bigint; maxFeePerGasWei: bigint };
  activator: ActivatorConfig;
  /** Per-merchant Pay in 4 cap set on activation, in AUSD base units. */
  activationCapUnits: bigint;
  /**
   * Settlement history a merchant needs before it is activated for Pay in 4
   * automatically: this many Pay-now payments, each from a different payer
   * (MERCHANT_ACTIVATION_MIN_PAYMENTS; 3 in production, 0 in development).
   * A brand-new merchant can take Pay now at once, but can't have a crowd of
   * fresh accounts draw their opening credit lines on it before it has sold
   * anything to anyone.
   */
  activationMinPayers: number;
  payoutSigner: { signerId: string; authorizationKey: string } | null;
  /**
   * The offline admin key quorum that owns our Privy policies
   * (PRIVY_ADMIN_QUORUM_ID, from setup-relayer). Without it a merchant's
   * payout policy is owned by the app, and the app secret alone could
   * rewrite its destination: production refuses to create one.
   */
  adminQuorumId: string | null;
  privyDisabled: boolean;
  keyPepper: string | undefined;
  dbUrl: string;
  /** The hosted checkout: session URLs are `${checkoutOrigin}/pay/${id}`. */
  checkoutOrigin: string;
  /** This server's own public URL. */
  publicUrl: string;
  /** Origins allowed to call /api/relay and /api/public from a browser. */
  appOrigins: string[];
  cronSecret: string | null;
  webhooks: { allowPrivate: boolean; timeoutMs: number };
  sessionTtlSeconds: number;
  payIn4: { installments: number; intervalSeconds: number; minCents: number; maxCents: number };
  receiptTimeoutMs: number;
  /** Background loops (webhooks, chain sync, payouts) in this process. */
  workers: boolean;
  /**
   * The CRE underwriting workflow: where its HTTP trigger listens
   * (`cre workflow simulate ./underwriting --listen` serves
   * http://localhost:2000/trigger), how far apart runs must be (CRE fires an
   * HTTP trigger at most once per 30 s), and the secret its signed
   * callbacks to /api/cre/callback carry.
   */
  cre: { underwritingTriggerUrl: string | null; minTriggerIntervalMs: number; callbackSecret: string | null };
  /** The underwriting gateway (apps/gateway), which explains an attested decision in the buyer's words. */
  underwriting: { gatewayUrl: string | null; apiToken: string | null };
  /**
   * How many proxies we run in front of this server, each appending to
   * X-Forwarded-For: the client's IP is that many entries from the right
   * (http.ts `clientIp`). 0 means Next is exposed directly.
   */
  trustedProxies: number;
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

  const checkoutOrigin = origin(env("POLARIS_CHECKOUT_ORIGIN") ?? (production ? "https://pay.polarispay.app" : "http://localhost:3000"), "POLARIS_CHECKOUT_ORIGIN");
  const publicUrl = origin(env("POLARIS_PUBLIC_URL") ?? (production ? "https://business.polarispay.app" : "http://localhost:3100"), "POLARIS_PUBLIC_URL");
  const extraOrigins = (env("POLARIS_APP_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => origin(s, "POLARIS_APP_ORIGINS"));
  const appOrigins = [...new Set([checkoutOrigin, ...extraOrigins, ...(production ? [] : ["http://localhost:3000"])])];

  const signerId = env("PRIVY_PAYOUT_SIGNER_ID") ?? env("NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID");
  const signerKey = env("PRIVY_PAYOUT_SIGNER_KEY");

  const payIn4Interval = int("PAY_IN_4_INTERVAL_SECONDS", 7 * 24 * 3600);

  return {
    production,
    chain,
    chainProblem,
    relayer: relayerFrom(chain),
    relayerLimits: {
      minTransferUnits: BigInt(Math.max(1, int("RELAYER_MIN_TRANSFER_UNITS", 100_000))), // $0.10
      maxGas: BigInt(Math.max(21_000, int("RELAYER_MAX_GAS", 3_000_000))),
      maxFeePerGasWei: BigInt(Math.max(1, int("RELAYER_MAX_FEE_GWEI", 1_000))) * 1_000_000_000n,
    },
    activator: activatorFrom(chain),
    activationCapUnits: BigInt(int("MERCHANT_ACTIVATION_CAP_USD", 1_000)) * 1_000_000n,
    activationMinPayers: Math.max(0, int("MERCHANT_ACTIVATION_MIN_PAYMENTS", production ? 3 : 0)),
    payoutSigner: signerId && signerKey ? { signerId, authorizationKey: signerKey } : null,
    adminQuorumId: env("PRIVY_ADMIN_QUORUM_ID") ?? null,
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
    cre: {
      underwritingTriggerUrl: env("CRE_UNDERWRITING_TRIGGER_URL") ?? null,
      minTriggerIntervalMs: Math.max(0, int("CRE_TRIGGER_MIN_INTERVAL_MS", 30_000)),
      callbackSecret: env("POLARIS_CRE_CALLBACK_SECRET") ?? null,
    },
    underwriting: {
      gatewayUrl: (env("UNDERWRITING_GATEWAY_URL") ?? "").replace(/\/+$/, "") || null,
      apiToken: env("UNDERWRITING_API_TOKEN") ?? null,
    },
    // POLARIS_TRUST_PROXY=1 (the older setting) means one proxy.
    trustedProxies: Math.max(0, int("POLARIS_TRUSTED_PROXIES", flag("POLARIS_TRUST_PROXY") ? 1 : 0)),
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

/** What production needs before it takes money: called by the health route and the workers. */
export function productionProblems(config = getConfig()): string[] {
  if (!config.production) return [];
  const problems: string[] = [];
  if (!config.keyPepper) problems.push("POLARIS_KEY_PEPPER is not set: secret keys would be stored as plain SHA-256.");
  if (!config.cronSecret) problems.push("CRON_SECRET is not set: the cron routes are closed.");
  if (config.relayer.mode === "local") problems.push("The relayer signs with a raw key.");
  if (config.payoutSigner && !config.adminQuorumId) {
    problems.push("PRIVY_ADMIN_QUORUM_ID is not set: automatic payout policies would be owned by the app, and the app secret alone could redirect them (they are refused until it is set).");
  }
  if (config.trustedProxies === 0) {
    problems.push("POLARIS_TRUSTED_PROXIES is not set: per-IP rate limits can't tell a client's own X-Forwarded-For from the one our proxy wrote.");
  }
  return problems;
}

export function explorerTxUrl(hash: string, config = getConfig()): string | null {
  return config.chain?.explorerUrl ? `${config.chain.explorerUrl}/tx/${hash}` : null;
}
