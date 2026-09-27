/**
 * The underwriting handler under the CRE SDK's test runtime, with every
 * provider answered from @polarispay/underwriting's fixtures.
 *
 * The facts the workflow reports are held to what the package's own Node
 * path derives for the same persona, and the report to the receiver's ABI.
 */

import { test as bunTest, describe, expect } from "bun:test";
import { cre, type HTTPPayload } from "@chainlink/cre-sdk";
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { scoreManagerAbi, underwritingReceiverAbi } from "@polarispay/contracts/abi";
import { join } from "node:path";
import {
  accountRecipe,
  LIQUIDATION_POOLS,
  linkedRecipe,
  linkMessage,
  type Reply,
  runSync,
  scoreFromFacts,
  underwrite,
} from "@polarispay/underwriting";
import { type Address, encodeErrorResult, getAddress, type Hex, parseAbi, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyCallback } from "../src/shared/callback.ts";
import { underwriteConsentMessage } from "../src/underwriting/consent.ts";
import { decodeUnderwritingReport } from "../src/underwriting/report.ts";
import { configSchema, onHttpTrigger, type UnderwritingConfig } from "../src/underwriting/workflow.ts";
import { b64, eventLog, fakeTxHash, hexOf, receiptJson, type TestLog } from "./helpers/evm.ts";
import { fs } from "./helpers/host.ts";
import { answerFromFixtures, cloneFixtures, type CreRequestLike, type SentRequest, toSent } from "./helpers/fixtures-http.ts";

const RECEIVER = "0x0000000000000000000000000000000000000c0d" as Address;
const SCORES = "0x0000000000000000000000000000000000005c03" as Address;
const AUSD = "0x0000000000000000000000000000000000a05d00" as Address;
const FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as Address;
const SELECTOR = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS["monad-testnet"];
/** The fixtures are dated against this instant (packages/underwriting/fixtures/personas.json). */
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0) / 1000;

const REGULAR_ACCOUNT = "0xacc0000000000000000000000000000000000002" as Address;
const FRESH_ACCOUNT = "0xacc0000000000000000000000000000000000001" as Address;
const STRONG = "0xb0b0000000000000000000000000000000000001" as Address;

// Test-only keys (Hardhat's public defaults): the account and the history
// wallet must both sign, and the personas have no keys.
const walletKey = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const buyerKey = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const attackerKey = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
// A brand-new Polaris account: the fresh-account persona (three days old, a claim link, $37.60).
const newcomerKey = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");
const buyer = getAddress(buyerKey.address);
const newcomer = getAddress(newcomerKey.address);
const FIXTURES = cloneFixtures([
  { from: STRONG, to: walletKey.address },
  { from: REGULAR_ACCOUNT, to: buyer },
  { from: FRESH_ACCOUNT, to: newcomer },
]);

const STAGING = JSON.parse(fs.readFileSync(join(import.meta.dir, "..", "underwriting", "config.staging.json"), "utf8"));
const recipeOptions = (balance: number) => ({
  now: NOW,
  accountBalance: balance,
  historyRpcUrls: STAGING.recipe.historyRpcUrls as string[],
  liquidationPools: Object.fromEntries((STAGING.recipe.liquidationChainIds as number[]).map((id) => [id, LIQUIDATION_POOLS[id] ?? []])),
});

const KEYS = new Map([
  [
    "main",
    new Map([
      ["NANSEN_API_KEY", "nansen-test-key"],
      ["ZERION_API_KEY", "zerion-test-key"],
      ["ETHERSCAN_API_KEY", "etherscan-test-key"],
    ]),
  ],
]);

const config = (over: Partial<UnderwritingConfig> = {}): UnderwritingConfig =>
  configSchema.parse({
    chainSelectorName: "monad-testnet",
    receiver: RECEIVER,
    scoreManager: SCORES,
    forwarder: FORWARDER,
    stablecoins: [AUSD],
    authorizedKeys: [],
    secrets: { nansen: "NANSEN_API_KEY", zerion: "ZERION_API_KEY", etherscan: "ETHERSCAN_API_KEY" },
    // The staging recipe, so these tests hold the committed config to CRE's quotas.
    recipe: STAGING.recipe,
    httpBudget: 15,
    cacheMaxAgeSeconds: 300,
    allowPartial: false,
    gas: { overhead: "80000", headroomBps: 1500, min: "200000", max: "3000000" },
    callback: null,
    ...over,
  });

const EVENTS = parseAbi([
  "event UnderwritingApplied(address indexed user, address indexed linkedWallet, uint16 score)",
  "event UnderwritingRefused(address indexed user, address indexed linkedWallet, bytes reason)",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

interface Setup {
  profile?: { initialized: boolean; underwritten: boolean; liquidations: number };
  requireUnderwriting?: boolean;
  linkedTo?: Address;
  balance?: bigint;
  /** What the receiver does with the report; default: apply the mirror's score. */
  refuse?: Hex;
  /** UnderwritingReceiver.simulationTransmitter(); zero once on the production forwarder. */
  transmitter?: Address;
}

function wire(setup: Setup = {}) {
  const evm = EvmMock.testInstance(SELECTOR);
  const seen = { reads: 0, reports: [] as Hex[], sent: [] as SentRequest[], estimates: [] as Array<{ from: string; to: string }> };
  const scores = addContractMock(evm, { address: SCORES, abi: scoreManagerAbi });
  scores.profileOf = () => {
    seen.reads++;
    const p = setup.profile ?? { initialized: false, underwritten: false, liquidations: 0 };
    return { score: 600, onTimePayments: 0, latePayments: 0, liquidations: p.liquidations, firstSeenAt: 0n, initialized: p.initialized, declined: false, underwritten: p.underwritten };
  };
  scores.requireUnderwriting = () => {
    seen.reads++;
    return setup.requireUnderwriting ?? true;
  };
  const receiver = addContractMock(evm, { address: RECEIVER, abi: underwritingReceiverAbi });
  receiver.linkedUserOf = () => {
    seen.reads++;
    return setup.linkedTo ?? zeroAddress;
  };
  receiver.simulationTransmitter = () => setup.transmitter ?? zeroAddress;
  const token = addContractMock(evm, { address: AUSD, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]) });
  token.balanceOf = () => {
    seen.reads++;
    return setup.balance ?? 455_000_000n;
  };
  evm.estimateGas = (req) => {
    seen.estimates.push({ from: hexOf(req.msg!.from).toLowerCase(), to: hexOf(req.msg!.to).toLowerCase() });
    return { gas: "180000" };
  };
  let logs: TestLog[] = [];
  evm.writeReport = (req) => {
    const body = `0x${hexOf(req.report!.rawReport).slice(2 + 218)}` as Hex;
    seen.reports.push(body);
    const { items } = decodeUnderwritingReport(body);
    const item = items[0]!;
    const linkedWallet = item.linkedWallet ?? zeroAddress;
    logs = [
      setup.refuse
        ? eventLog(EVENTS, "UnderwritingRefused", RECEIVER, { user: item.user, linkedWallet, reason: setup.refuse })
        : eventLog(EVENTS, "UnderwritingApplied", RECEIVER, { user: item.user, linkedWallet, score: scoreFromFacts(item.facts).score }),
      eventLog(EVENTS, "ReportProcessed", FORWARDER, { receiver: RECEIVER, workflowExecutionId: fakeTxHash("e"), reportId: "0x0001", result: true }),
    ];
    return { txStatus: "TX_STATUS_SUCCESS", txHash: b64(fakeTxHash("uw")) };
  };
  evm.getTransactionReceipt = () => receiptJson(logs);
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (input) => {
    const s = toSent(input as unknown as CreRequestLike);
    seen.sent.push(s);
    return answerFromFixtures(s, FIXTURES);
  };
  return seen;
}

const trigger = (input: unknown): HTTPPayload =>
  ({ input: new TextEncoder().encode(JSON.stringify(input)) }) as unknown as HTTPPayload;

function runWith(cfg: UnderwritingConfig, input: unknown, secrets = KEYS) {
  const runtime = newTestRuntime(secrets, { timeProvider: () => NOW * 1000 }, cfg);
  return JSON.parse(onHttpTrigger(runtime, trigger(input)));
}

async function proof(account: Address, issuedAt = NOW - 60, nonce = "k3J9xq2LmN") {
  const signature = await walletKey.signMessage({ message: linkMessage({ account, wallet: walletKey.address, issuedAt, nonce }) });
  return { wallet: walletKey.address, issuedAt, nonce, signature };
}

/** The account's own consent: signed by `signer` (the buyer unless a test says otherwise). */
async function consent(
  wallet: Address | null = null,
  over: Partial<{ account: Address; chainId: number; issuedAt: number; nonce: string; signer: typeof buyerKey }> = {},
) {
  const issuedAt = over.issuedAt ?? NOW - 30;
  const nonce = over.nonce ?? "c0nsentN0nce";
  const message = underwriteConsentMessage({ account: over.account ?? buyer, wallet, chainId: over.chainId ?? STAGING.recipe.accountChainId, issuedAt, nonce });
  return { issuedAt, nonce, signature: await (over.signer ?? buyerKey).signMessage({ message }) };
}

/** A payload the buyer signed: the account alone, or with the history wallet's proof. */
async function asks(linked: Awaited<ReturnType<typeof proof>> | null = null) {
  return { user: buyer, consent: await consent(linked?.wallet ?? null), ...(linked ? { linked } : {}) };
}

/** What the package's own recipe and core derive for the same inputs: the workflow must agree. */
function packageFacts(user: Address, wallet: Address | null, balance: number) {
  const send = (spec: { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string }): Reply => {
    const r = answerFromFixtures({ url: spec.url, method: spec.method, headers: spec.headers, body: spec.body, cached: true }, FIXTURES);
    return { ok: true, status: r.statusCode, body: JSON.parse(Buffer.from(r.body, "base64").toString("utf8")) };
  };
  const opts = recipeOptions(balance);
  const account = runSync(accountRecipe(user, opts), send);
  const linked = wallet ? runSync(linkedRecipe(wallet, opts), send) : null;
  return underwrite({ user, observedAt: NOW, account: account.evidence, linked: linked?.evidence ?? null, linkVerified: true });
}

test("account alone: one report with the facts the package derives, applied at the mirror's score", async () => {
  const seen = wire();
  const out = runWith(config(), await asks());
  expect(out.status).toBe("applied");
  expect(seen.reports).toHaveLength(1);
  const { kind, items } = decodeUnderwritingReport(seen.reports[0]!);
  expect(kind).toBe(2);
  const expected = packageFacts(buyer, null, 455_000_000);
  expect(expected.final).toBe(true);
  expect(items).toEqual([{ user: buyer, linkedWallet: null, facts: { ...expected.facts, observedAt: BigInt(NOW) } }]);
  expect(out.onChainScore).toBe(expected.breakdown.score);
  expect(out.expectedScore).toBe(expected.breakdown.score);
  // The account's dollars came from EVM reads, so its data costs a single HTTP call.
  expect(seen.sent.every((s) => !s.url.includes("testnet-rpc.monad.xyz"))).toBe(true);
});

test("bring your history: a fresh proof from the wallet raises the facts; keys ride in headers, never in URLs", async () => {
  const seen = wire();
  const out = runWith(config(), await asks(await proof(buyer)));
  expect(out.status).toBe("applied");
  const { items } = decodeUnderwritingReport(seen.reports[0]!);
  const expected = packageFacts(buyer, walletKey.address, 455_000_000);
  expect(items[0]!.linkedWallet).toBe(walletKey.address);
  expect(items[0]!.facts).toEqual({ ...expected.facts, observedAt: BigInt(NOW) });
  expect(items[0]!.facts.exchangeFunded).toBe(true); // Nansen: first funded from Coinbase
  // The history is what moves the line: the same account alone scores lower.
  expect(out.onChainScore).toBe(expected.breakdown.score);
  expect(out.onChainScore).toBeGreaterThan(packageFacts(buyer, null, 455_000_000).breakdown.score);

  const nansen = seen.sent.filter((s) => s.url.startsWith("https://api.nansen.ai"));
  expect(nansen.length).toBeGreaterThan(0);
  expect(nansen.every((s) => s.headers.apikey === "nansen-test-key")).toBe(true);
  const zerion = seen.sent.filter((s) => s.url.startsWith("https://api.zerion.io"));
  expect(zerion.every((s) => s.headers.authorization?.startsWith("Basic "))).toBe(true);
  for (const s of seen.sent) {
    if (!s.url.startsWith("https://api.etherscan.io")) expect(s.url).not.toContain("test-key");
    expect(s.cached).toBe(true);
  }
  expect(out.httpCalls).toBeLessThanOrEqual(15);
});

test("while simulating, gas is estimated for the whole delivery from the simulation transmitter", async () => {
  const transmitter = "0x00000000000000000000000000000000000000a1" as Address;
  const seen = wire({ transmitter });
  expect(runWith(config(), await asks()).status).toBe("applied");
  expect(seen.estimates).toEqual([{ from: transmitter, to: FORWARDER.toLowerCase() }]);
});

test("on the production forwarder, gas is estimated for onReport as the forwarder calls it", async () => {
  const seen = wire();
  runWith(config(), await asks());
  expect(seen.estimates).toEqual([{ from: FORWARDER.toLowerCase(), to: RECEIVER.toLowerCase() }]);
});

test("a proof signed by another key is refused before any read or paid call", async () => {
  const seen = wire();
  const p = await proof(buyer);
  const forged = { ...p, wallet: STRONG };
  const out = runWith(config(), { user: buyer, consent: await consent(STRONG), linked: forged });
  expect(out.status).toBe("rejected");
  expect(out.reason).toContain("not signed by the wallet");
  expect(seen.reads).toBe(0);
  expect(seen.sent).toHaveLength(0);
  expect(seen.reports).toHaveLength(0);
});

describe("the account's own consent", () => {
  test("is required: a payload without it is refused before anything is read", () => {
    const seen = wire();
    expect(() => runWith(config(), { user: buyer })).toThrow(/consent is required/);
    expect(seen.reads).toBe(0);
    expect(seen.sent).toHaveLength(0);
  });

  test("signed by anyone but the account (whoever fires the trigger) is rejected before any read or paid call", async () => {
    const seen = wire();
    const out = runWith(config(), { user: buyer, consent: await consent(null, { signer: attackerKey }) });
    expect(out.status).toBe("rejected");
    expect(out.reason).toContain("the account did not consent");
    expect(seen.reads).toBe(0);
    expect(seen.sent).toHaveLength(0);
    expect(seen.reports).toHaveLength(0);
  });

  test("to be underwritten alone cannot be used to link a wallet the account never named", async () => {
    // The attacker owns the wallet (say, one with liquidations) and signs its link proof for the
    // victim, then replays the victim's consent to be underwritten alone.
    const seen = wire();
    const out = runWith(config(), { user: buyer, consent: await consent(null), linked: await proof(buyer) });
    expect(out.status).toBe("rejected");
    expect(out.reason).toContain("the account did not consent");
    expect(seen.reads).toBe(0);
    expect(seen.sent).toHaveLength(0);
  });

  test("naming one wallet cannot vouch for another, nor for the account alone", async () => {
    wire();
    const named = await consent(STRONG);
    expect(runWith(config(), { user: buyer, consent: named, linked: await proof(buyer) }).status).toBe("rejected");
    expect(runWith(config(), { user: buyer, consent: named }).status).toBe("rejected");
  });

  test("is good for 15 minutes, on its own chain, for its own account", async () => {
    const seen = wire();
    const stale = runWith(config(), { user: buyer, consent: await consent(null, { issuedAt: NOW - 16 * 60 }) });
    expect(stale).toMatchObject({ status: "rejected", reason: expect.stringContaining("account consent older than 15 minutes") });
    const future = runWith(config(), { user: buyer, consent: await consent(null, { issuedAt: NOW + 5 * 60 }) });
    expect(future).toMatchObject({ status: "rejected", reason: expect.stringContaining("issued in the future") });
    expect(runWith(config(), { user: buyer, consent: await consent(null, { chainId: 1 }) }).status).toBe("rejected");
    const other = getAddress(attackerKey.address);
    expect(runWith(config(), { user: other, consent: await consent(null) }).status).toBe("rejected");
    expect(seen.sent).toHaveLength(0);
    expect(seen.reports).toHaveLength(0);
  });
});

describe("a thin file", () => {
  const newcomerAsks = async (linked: Awaited<ReturnType<typeof proof>> | null = null) => ({
    user: newcomer,
    consent: await consent(linked?.wallet ?? null, { account: newcomer, signer: newcomerKey }),
    ...(linked ? { linked } : {}),
  });

  test("a brand-new account alone gets no report, so no free $200 line", async () => {
    const seen = wire();
    const out = runWith(config(), await newcomerAsks());
    expect(out.status).toBe("thin");
    expect(out.reason).toContain("thin file");
    // What the chain would have done with it: the floor plus the balance, the $200 tier.
    expect(out.expectedScore).toBeGreaterThanOrEqual(520);
    expect(out.expectedScore).toBeLessThan(580);
    expect(seen.reports).toHaveLength(0);
    expect(out.txHash).toBeNull();
  });

  test("says so to the API, signed, keyed on the request's nonce", async () => {
    wire();
    const secrets = new Map([["main", new Map([...KEYS.get("main")!, ["POLARIS_CALLBACK_SECRET", "cb-secret"]])]]);
    const callbackUrl = "https://api.polaris.test/v1/cre/underwriting";
    const posted: SentRequest[] = [];
    const http = HttpActionsMock.testInstance();
    http.sendRequest = (input) => {
      const s = toSent(input as unknown as CreRequestLike);
      if (s.url === callbackUrl) {
        posted.push(s);
        return { statusCode: 204 };
      }
      return answerFromFixtures(s, FIXTURES);
    };
    const asked = await newcomerAsks();
    const out = runWith(config({ callback: { url: callbackUrl, secretId: "POLARIS_CALLBACK_SECRET" } }), asked, secrets);
    expect(out.status).toBe("thin");
    expect(posted).toHaveLength(1);
    expect(verifyCallback("cb-secret", posted[0]!.body!, posted[0]!.headers["polaris-signature"], NOW).ok).toBe(true);
    expect(JSON.parse(posted[0]!.body!)).toMatchObject({
      id: `thin:${newcomer.toLowerCase()}:${asked.consent.nonce}`,
      type: "credit.thin",
      user: newcomer,
      txHash: null,
      reason: expect.stringContaining("thin file"),
    });
  });

  test("opens once the buyer brings a history wallet", async () => {
    const seen = wire();
    const out = runWith(config(), await newcomerAsks(await proof(newcomer)));
    expect(out.status).toBe("applied");
    expect(seen.reports).toHaveLength(1);
    expect(out.onChainScore).toBeGreaterThan(520);
  });

  test("an account with a history of its own is not thin", async () => {
    // The regular persona: four months, 120 transfers.
    wire();
    expect(runWith(config(), await asks()).status).toBe("applied");
  });
});

test("a stale proof is refused", async () => {
  const seen = wire();
  const out = runWith(config(), await asks(await proof(buyer, NOW - 16 * 60)));
  expect(out.status).toBe("rejected");
  expect(out.reason).toContain("link proof older than 15 minutes");
  expect(seen.sent).toHaveLength(0);
});

test("a proof for another account cannot be replayed for this one", async () => {
  const seen = wire();
  // The other account consents to linking the wallet, but the wallet vouched for the buyer.
  const other = getAddress(attackerKey.address);
  const out = runWith(config(), {
    user: other,
    consent: await consent(walletKey.address, { account: other, signer: attackerKey }),
    linked: await proof(buyer),
  });
  expect(out.status).toBe("rejected");
  expect(out.reason).toContain("not signed by the wallet");
  expect(seen.sent).toHaveLength(0);
});

test("an account ScoreManager already underwrote costs no provider call", async () => {
  const seen = wire({ profile: { initialized: true, underwritten: true, liquidations: 0 } });
  const out = runWith(config(), await asks());
  expect(out.status).toBe("skipped");
  expect(seen.sent).toHaveLength(0);
  expect(seen.reports).toHaveLength(0);
});

test("a history wallet already backing another account is refused before any provider call", async () => {
  const seen = wire({ linkedTo: FRESH_ACCOUNT });
  const out = runWith(config(), await asks(await proof(buyer)));
  expect(out.status).toBe("rejected");
  expect(out.reason).toContain("WalletAlreadyLinked");
  expect(seen.sent).toHaveLength(0);
});

test("without Nansen the history wallet's risk checks cannot run: no report, the app retries", async () => {
  const seen = wire();
  const noNansen = new Map([["main", new Map([["ZERION_API_KEY", "z"], ["ETHERSCAN_API_KEY", "e"]])]]);
  const out = runWith(config(), await asks(await proof(buyer)), noNansen);
  expect(out.status).toBe("incomplete");
  expect(out.missing.some((m: string) => m.startsWith("linked."))).toBe(true);
  expect(seen.reports).toHaveLength(0);
  expect(seen.sent.some((s) => s.url.startsWith("https://api.nansen.ai"))).toBe(false);
});

test("a refusal on chain is reported with ScoreManager's reason", async () => {
  wire({ refuse: encodeErrorResult({ abi: scoreManagerAbi, errorName: "StaleEvidence" }) });
  const out = runWith(config(), await asks());
  expect(out.status).toBe("refused");
  expect(out.reason).toBe("StaleEvidence");
});

test("malformed input fails loudly", async () => {
  wire();
  const c = await consent();
  expect(() => runWith(config(), { user: "0x1234", consent: c })).toThrow(/user must be a 0x-prefixed 20-byte address/);
  expect(() => runWith(config(), { user: buyer, consent: c, extra: 1 })).toThrow(/underwriting payload/);
});

// Pure (no CRE runtime), but it reads the fixtures 24 times over: give a busy
// disk more than bun's default 5 s.
bunTest("the staging recipe fits CRE's 15 HTTP calls for every fixture persona pair but the worst case, which it names", () => {
  const personas = [2, 3, 4, 5, 6, 7, 8].map((i) => `0xb0b000000000000000000000000000000000000${i}` as Address);
  const over: string[] = [];
  for (const account of [REGULAR_ACCOUNT, FRESH_ACCOUNT, "0xacc0000000000000000000000000000000000003" as Address]) {
    for (const wallet of [null, ...personas]) {
      let calls = 0;
      const send = (spec: { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string }): Reply => {
        calls++;
        const r = answerFromFixtures({ url: spec.url, method: spec.method, headers: spec.headers, body: spec.body, cached: true });
        return { ok: true, status: r.statusCode, body: JSON.parse(Buffer.from(r.body, "base64").toString("utf8")) };
      };
      runSync(accountRecipe(account, recipeOptions(0)), send);
      if (wallet) runSync(linkedRecipe(wallet, recipeOptions(0)), send);
      if (calls > 15) over.push(`${account.slice(-1)}+${wallet?.slice(-1)}`);
    }
  }
  // Only a busy account (dated with probes) plus a wallet Nansen has no funder
  // for (dated with probes too), with all three liquidation chains counted.
  expect(over.sort()).toEqual(["2+6", "3+6"]);
}, 60_000);

test("over the call budget, the run stops without a report rather than attest what it could not read", async () => {
  const noFunder = cloneFixtures([
    { from: "0xb0b0000000000000000000000000000000000006", to: walletKey.address },
    { from: REGULAR_ACCOUNT, to: buyer },
  ]);
  const seen = wire();
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (input) => {
    const s = toSent(input as unknown as CreRequestLike);
    seen.sent.push(s);
    return answerFromFixtures(s, noFunder);
  };
  const out = runWith(config(), await asks(await proof(buyer)));
  expect(out.status).toBe("incomplete");
  expect(out.httpCalls).toBe(15);
  expect(seen.sent).toHaveLength(15);
  expect(out.missing.length).toBeGreaterThan(0);
  expect(seen.reports).toHaveLength(0);
});
