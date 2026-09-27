import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { decodeUnderwritingReport } from "../src/core/abi.ts";
import { linkMessage } from "../src/core/link.ts";
import type { Address } from "../src/core/types.ts";
import { fixtureTransport } from "../src/node/fixtures.ts";
import type { HttpTransport } from "../src/node/http.ts";
import { NansenClient } from "../src/node/nansen.ts";
import { CreditMeter, Underwriter } from "../src/node/service.ts";
import { ACCOUNT, fixtureProviders, host, LINKED, networkDown, NOW, scripted } from "./helpers.ts";

// A throwaway key generated for this test; it controls nothing.
const OWNER = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

async function proofFor(account: Address, wallet = OWNER, issuedAt = NOW - 60, nonce = "n0nce-12345") {
  const signature = await wallet.signMessage({ message: linkMessage({ account, wallet: wallet.address, issuedAt, nonce }) });
  return { issuedAt, nonce, signature };
}

/** Providers on fixtures, with the throwaway owner's address read as the strong persona's history. */
function underwriterOn(transport: HttpTransport = fixtureTransport(), meter = new CreditMeter()) {
  const from = OWNER.address.toLowerCase();
  const alias = (s: string) => s.replaceAll(from, LINKED.strong).replaceAll(from.slice(2), LINKED.strong.slice(2));
  const t: HttpTransport = (req, signal) => transport({ ...req, url: alias(req.url), body: req.body && alias(req.body) }, signal);
  const p = fixtureProviders(t);
  p.nansen = new NansenClient({ mode: "fixture", transport: t, clock: p.clock, cacheTtlMs: 0, onResponse: (_s, res) => meter.record(res.headers) });
  return new Underwriter({ providers: p, now: () => NOW, creditMeter: meter });
}

describe("Underwriter.assess", () => {
  it("a proven linked wallet is final, carries a report ScoreManager can decode, and costs one Nansen credit", async () => {
    const meter = new CreditMeter();
    const uw = underwriterOn(fixtureTransport(), meter);
    const a = await uw.assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address, proof: await proofFor(ACCOUNT.fresh) }, purchase: 200_000_000n });
    assert.deepEqual(a.linkProof, { verified: true, reason: null });
    assert.equal(a.final, true);
    assert.equal(a.breakdown.score, 692);
    assert.equal(a.dataMode, "fixture");
    assert.equal(a.retryAfterSeconds, null);
    assert.equal(a.credits.nansen, 1, "first-funder only: an exchange-funded wallet skips related-wallets");
    const r = decodeUnderwritingReport(a.report!);
    assert.equal(r.kind, 2);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]!.user, ACCOUNT.fresh.toLowerCase());
    assert.equal(r.items[0]!.linkedWallet, OWNER.address.toLowerCase(), "the receiver needs the wallet to hold it to one account");
    assert.equal(a.linkedWallet?.toLowerCase(), OWNER.address.toLowerCase());
    assert.deepEqual(r.items[0]!.facts, a.facts);
    assert.equal(a.facts.observedAt, BigInt(NOW));
  });

  it("without a proof, the linked wallet is only a preview", async () => {
    const a = await underwriterOn().assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address } });
    assert.equal(a.final, false);
    assert.deepEqual(a.missing, ["linked.ownership"]);
    assert.equal(a.report, null);
    assert.equal(a.retryAfterSeconds, null, "waiting will not help; the buyer has to confirm");
    assert.equal(a.linkProof?.reason, "no ownership proof");
  });

  it("a proof signed by another wallet does not count", async () => {
    const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const forged = await proofFor(ACCOUNT.fresh, other);
    const a = await underwriterOn().assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address, proof: forged } });
    assert.equal(a.linkProof?.verified, false);
    assert.equal(a.final, false);
  });

  it("a proof for another Polaris account does not count", async () => {
    const a = await underwriterOn().assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address, proof: await proofFor(ACCOUNT.regular) } });
    assert.equal(a.linkProof?.verified, false);
  });

  it("a stale proof does not count", async () => {
    const a = await underwriterOn().assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address, proof: await proofFor(ACCOUNT.fresh, OWNER, NOW - 3600) } });
    assert.deepEqual(a.linkProof, { verified: false, reason: "proof older than 15 minutes" });
  });

  it("tells the app when to retry when a provider is down", async () => {
    const t = scripted(fixtureTransport(), [{ match: host("api.nansen.ai"), respond: networkDown }]);
    const a = await underwriterOn(t).assess({ account: ACCOUNT.fresh, linked: { wallet: OWNER.address, proof: await proofFor(ACCOUNT.fresh) } });
    assert.equal(a.final, false);
    assert.ok((a.retryAfterSeconds ?? 0) >= 30);
    assert.ok(a.issues.every((i) => !JSON.stringify(i).includes("apikey")));
  });

  it("builds from the environment: fixtures without keys, live with them", () => {
    const none = Underwriter.fromEnv({});
    assert.deepEqual(none.modes(), { nansen: "fixture", zerion: "fixture", etherscan: "fixture", rpc: "fixture" });
    const some = Underwriter.fromEnv({ NANSEN_API_KEY: "nk" });
    assert.deepEqual(some.modes(), { nansen: "live", zerion: "fixture", etherscan: "fixture", rpc: "live" });
    const forced = Underwriter.fromEnv({ NANSEN_API_KEY: "nk", UNDERWRITING_MODE: "fixture" });
    assert.equal(forced.modes().nansen, "fixture");
  });
});
