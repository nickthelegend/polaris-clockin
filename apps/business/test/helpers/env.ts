import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openSqliteStore, type Transport } from "@polaris/db";
import { getAddress, type Abi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  collectionsReceiverAbi,
  iausdAbi,
  merchantRegistryAbi,
  polarisCheckoutAbi,
  polarisLoanEngineAbi,
  polarisPaymentsAbi,
  polarisSendAbi,
} from "@polarispay/contracts/abi";
import { setMerchantVerifierForTests, type AuthedMerchant } from "@/server/auth";
import { resetClientForTests, setPublicClientForTests } from "@/server/chain/client";
import { replaceStoreForTests } from "@/server/db";
import { resetConfig } from "@/server/env";
import { resetPrivyForTests } from "@/server/privy";
import { resetRateLimitsForTests } from "@/server/ratelimit";
import { resetEligibilityForTests } from "@/server/sessions/sessions";
import { resetSignersForTests } from "@/server/relayer/signer";
import { resetNoncesForTests } from "@/server/relayer/submit";
import { configureDispatcherForTests } from "@/server/webhooks/dispatcher";

import { FakeChain } from "./fake-chain";

export const DEPLOYMENT = fileURLToPath(new URL("../fixtures/deployment.json", import.meta.url));

const fixture = JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as { contracts: Record<string, { address: string }> };
const at = (name: string) => getAddress(fixture.contracts[name]?.address as string);

export const ADDR = {
  stablecoin: at("Stablecoin"),
  scoreManager: at("ScoreManager"),
  loanEngine: at("PolarisLoanEngine"),
  payments: at("PolarisPayments"),
  registry: at("MerchantRegistry"),
  send: at("PolarisSend"),
  checkout: at("PolarisCheckout"),
  collections: at("CollectionsReceiver"),
};

export const ALL_ABIS = [polarisCheckoutAbi, polarisPaymentsAbi, polarisLoanEngineAbi, polarisSendAbi, merchantRegistryAbi, iausdAbi, collectionsReceiverAbi] as unknown as Abi[];

export type TestEnv = {
  chain: FakeChain;
  relayerKey: `0x${string}`;
  relayerAddress: Address;
  deliveries: Array<{ url: string; headers: Record<string, string>; body: string }>;
  respondWith: (status: number) => void;
};

/**
 * A fresh server for one test: in-memory store, the fixture deployment on
 * chain 31337, a local relayer key, a fake chain behind viem's client, and a
 * recording webhook transport. Privy is off; dashboard routes authenticate
 * through `signIn`.
 */
export function setupServer(env: Record<string, string> = {}): TestEnv {
  const relayerKey = generatePrivateKey();
  const base: Record<string, string> = {
    POLARIS_DEPLOYMENT_FILE: DEPLOYMENT,
    POLARIS_RPC_URL: "http://127.0.0.1:1",
    RELAYER_MODE: "local",
    RELAYER_PRIVATE_KEY: relayerKey,
    REGISTRY_ACTIVATOR: "off",
    POLARIS_DB_URL: "memory:",
    POLARIS_KEY_PEPPER: "test-pepper",
    POLARIS_DISABLE_PRIVY: "1",
    POLARIS_WORKERS: "0",
    POLARIS_CHECKOUT_ORIGIN: "http://localhost:3000",
    POLARIS_PUBLIC_URL: "http://localhost:3100",
    POLARIS_WEBHOOK_ALLOW_PRIVATE: "1",
    PAY_IN_4_INTERVAL_SECONDS: "604800",
    CRON_SECRET: "cron-test-secret",
    ...env,
  };
  for (const [k, v] of Object.entries(base)) process.env[k] = v;
  resetConfig();
  resetPrivyForTests();
  resetClientForTests();
  resetSignersForTests();
  resetNoncesForTests();
  resetRateLimitsForTests();
  resetEligibilityForTests();
  // SQLite in memory: the store production runs on, fresh for every test.
  replaceStoreForTests(openSqliteStore(":memory:"));
  setMerchantVerifierForTests(null);

  const chain = new FakeChain(ALL_ABIS);
  chain.reads = {
    canOriginate: () => true,
    nonces: () => 0n,
    balanceOf: () => 1_000_000_000n,
  };
  setPublicClientForTests(chain.client());

  const deliveries: TestEnv["deliveries"] = [];
  let status = 200;
  const transport: Transport = async (url, init) => {
    deliveries.push({ url: url.toString(), headers: init.headers, body: init.body });
    return { status, body: status < 300 ? "ok" : "nope" };
  };
  configureDispatcherForTests({ transport, autoKick: false });

  return { chain, relayerKey, relayerAddress: privateKeyToAccount(relayerKey).address, deliveries, respondWith: (s) => (status = s) };
}

/** Authenticate dashboard routes as this merchant (Privy's verification, replaced). */
export function signIn(merchant: Partial<AuthedMerchant> & { userId: string }): AuthedMerchant {
  const auth: AuthedMerchant = {
    walletAddress: null,
    walletId: null,
    email: null,
    sessionId: "ses_test",
    ...merchant,
  };
  setMerchantVerifierForTests(async () => auth);
  return auth;
}

export function request(method: string, url: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Request {
  // What Next adds from the socket when the client sent no X-Forwarded-For.
  const headers: Record<string, string> = { "x-forwarded-for": "127.0.0.1", ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:3100${url}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export async function json(res: Response): Promise<{ status: number; body: Record<string, unknown> & { data?: any; error?: any } }> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
