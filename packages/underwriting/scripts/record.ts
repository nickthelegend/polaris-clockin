/**
 * Record real provider responses as fixtures, and print the Day-0 checks from
 * docs/research/data.md §9.
 *
 *   NANSEN_API_KEY=… ZERION_API_KEY=… ETHERSCAN_API_KEY=… \
 *     pnpm --filter @polarispay/underwriting record --linked 0x<a wallet you own> [--account 0x<a Polaris account>] [--persona name]
 *
 * Runs one live underwriting through the same collectors the service uses,
 * saving every response under fixtures/ in the same layout the fixture
 * transport reads, marked `recorded: true`. Keys are sent only to their
 * providers and never written or printed; Etherscan's `apikey` query
 * parameter is stripped before anything is saved.
 *
 * Spends about 2 Nansen credits per linked wallet. Record only wallets whose
 * owners agreed: fixtures are committed to a public repository.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { HISTORY_CHAINS, MONAD_TESTNET } from "../src/core/constants.ts";
import { toJsonSafe } from "../src/core/evidence.ts";
import type { Address } from "../src/core/types.ts";
import { EtherscanClient } from "../src/node/etherscan.ts";
import { DEFAULT_FIXTURES_DIR, locateFixture, type FixtureFile } from "../src/node/fixtures.ts";
import { fetchTransport, type HttpRequest, type HttpResponse, type HttpTransport } from "../src/node/http.ts";
import { NansenClient } from "../src/node/nansen.ts";
import { RpcClient } from "../src/node/rpc.ts";
import { CreditMeter, Underwriter } from "../src/node/service.ts";
import { ZerionClient } from "../src/node/zerion.ts";

const { values } = parseArgs({
  options: {
    linked: { type: "string" },
    account: { type: "string" },
    persona: { type: "string", default: "recorded" },
    dir: { type: "string", default: DEFAULT_FIXTURES_DIR },
  },
});

const isAddr = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
if (!isAddr(values.linked) && !isAddr(values.account)) {
  console.error("usage: record --linked 0x… [--account 0x…] [--persona name]");
  process.exit(2);
}
const missingKeys = ["NANSEN_API_KEY", "ZERION_API_KEY", "ETHERSCAN_API_KEY"].filter((k) => !process.env[k]);
if (missingKeys.length) {
  console.error(`set ${missingKeys.join(", ")} first; recording needs live responses`);
  process.exit(2);
}

const dir = values.dir!;
const recordedAt = new Date().toISOString();
const KEEP_HEADERS = /^(x-nansen-credits-|ratelimit-|retry-after)/;
const firstFunderRaw: unknown[] = [];
const relations = new Set<string>();

/** Etherscan puts its key in the URL; nothing saved or printed may carry it. */
function redact(url: string): string {
  return url.replace(/([?&])apikey=[^&]*/i, "$1apikey=REDACTED");
}

function merge(previous: FixtureFile | null, body: unknown): unknown {
  // Probes (page[size]=1) must not overwrite a fuller recording: keep the union of rows.
  const prev = previous?.fixture.recorded ? (previous.body as { data?: Array<{ id?: string; transaction_hash?: string }> }) : null;
  const next = body as { data?: Array<{ id?: string; transaction_hash?: string }> };
  if (!prev?.data || !Array.isArray(next?.data)) return body;
  const key = (r: { id?: string; transaction_hash?: string }) => r.id ?? r.transaction_hash ?? JSON.stringify(r);
  const rows = new Map(prev.data.map((r) => [key(r), r]));
  for (const r of next.data) rows.set(key(r), r);
  return { ...next, data: [...rows.values()] };
}

function save(req: HttpRequest, res: HttpResponse): void {
  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    return;
  }
  const loc = locateFixture(req);
  const path = join(dir, loc.rel);
  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FixtureFile) : null;
  const fixture = {
    label: "RECORDED from the live API. Real data about a wallet whose owner agreed to publish it.",
    provider: loc.provider,
    request: `${req.method} ${redact(req.url)}`,
    shape: "as returned",
    persona: values.persona,
    recorded: true,
    recordedAt,
  };
  if (loc.rpcKey) {
    const calls = { ...(previous?.calls ?? {}), [loc.rpcKey]: String((body as { result?: unknown }).result ?? "") };
    writeFileSync(path, `${JSON.stringify({ fixture, calls }, null, 2)}\n`);
    return;
  }
  if (loc.provider === "nansen" && loc.endpoint === "first-funder") firstFunderRaw.push((body as { data?: unknown[] }).data?.[0] ?? null);
  if (loc.provider === "nansen" && loc.endpoint === "related-wallets") {
    for (const r of (body as { data?: Array<{ relation?: string }> }).data ?? []) if (r.relation) relations.add(r.relation);
  }
  const headers = Object.fromEntries(Object.entries(res.headers).filter(([k]) => KEEP_HEADERS.test(k)));
  const merged = res.status === 200 ? merge(previous, body) : body;
  writeFileSync(path, `${JSON.stringify({ fixture, status: res.status, headers, body: merged }, null, 2)}\n`);
}

const recorder: HttpTransport = async (req, signal) => {
  const res = await fetchTransport(req, signal);
  save(req, res);
  return res;
};

const meter = new CreditMeter();
const live = { mode: "live" as const, transport: recorder, cacheTtlMs: 0 };
const underwriter = new Underwriter({
  providers: {
    nansen: new NansenClient({ ...live, apiKey: process.env.NANSEN_API_KEY, onResponse: (_s, r) => meter.record(r.headers) }),
    zerion: new ZerionClient({ ...live, apiKey: process.env.ZERION_API_KEY }),
    etherscan: new EtherscanClient({ ...live, apiKey: process.env.ETHERSCAN_API_KEY }),
    accountRpc: new RpcClient(MONAD_TESTNET.rpcUrl, MONAD_TESTNET.chainId, live),
    historyRpcs: HISTORY_CHAINS.map((c) => new RpcClient(c.rpcUrl, c.chainId, live)),
  },
  creditMeter: meter,
});

const account = isAddr(values.account) ? values.account : ("0x0000000000000000000000000000000000000001" as Address);
const a = await underwriter.assess({ account, linked: isAddr(values.linked) ? { wallet: values.linked } : null });

console.log(JSON.stringify(toJsonSafe({ facts: a.facts, score: a.breakdown.score, declined: a.breakdown.declined, limit: a.decision.limit, missing: a.missing }), null, 2));
for (const r of a.decision.reasons) console.log(`  ${r.provider.padEnd(9)} ${r.text}`);
console.log("\nDay-0 checks (data.md §9):");
console.log(`  1. first-funder row as returned: ${JSON.stringify(firstFunderRaw[0] ?? null)}`);
console.log(`  2. related-wallets relation values: ${[...relations].sort().join(", ") || "(none seen)"}`);
console.log(`  6. Zerion ${MONAD_TESTNET.zerionChainId} rows for the account: ${a.evidence.account.sentCount.value} (${a.evidence.account.sentCount.status})`);
console.log(`  Nansen credits used: ${a.credits.nansen}`);
console.log(`  issues: ${a.issues.map((i) => `${i.source}:${i.code}`).join(", ") || "none"}`);
console.log(`\nfixtures saved under ${dir}`);
