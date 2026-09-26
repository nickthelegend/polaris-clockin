import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { encodeUnderwriteReport } from "../src/core/abi.ts";
import { createFetchHandler, createRouter, type RouteRequest } from "../src/node/handler.ts";
import { startUnderwritingServer } from "../src/node/server.ts";
import { Underwriter } from "../src/node/service.ts";
import { ACCOUNT, fixtureProviders, LINKED, NOW } from "./helpers.ts";

const uw = () => new Underwriter({ providers: fixtureProviders(), now: () => NOW });

const req = (o: Partial<RouteRequest> & { json?: unknown }): RouteRequest => ({
  method: o.method ?? "POST",
  url: o.url ?? "/v1/underwrite",
  headers: { "content-type": "application/json", ...(o.headers ?? {}) },
  body: o.body ?? (o.json === undefined ? "" : JSON.stringify(o.json)),
  client: o.client ?? "test",
});

describe("the underwriting API", () => {
  it("GET /health reports each provider's mode", async () => {
    const res = await createRouter(uw())(req({ method: "GET", url: "/health" }));
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.modes, { nansen: "fixture", zerion: "fixture", etherscan: "fixture", rpc: "fixture" });
    assert.deepEqual(body.version, { facts: 1, model: 1 });
  });

  it("POST /v1/underwrite: the decision, with amounts as base-unit strings", async () => {
    const res = await createRouter(uw())(req({ json: { account: ACCOUNT.fresh, purchase: "150.00" } }));
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.final, true);
    assert.equal(body.dataMode, "fixture");
    assert.equal(body.decision.limit, "200000000");
    assert.equal(body.decision.payIn4.allowed, true);
    assert.equal(body.decision.payIn4.quote.total, "151150684");
    assert.equal(body.facts.stableBalance, "37600000");
    assert.match(body.report, /^0x[0-9a-f]{640}$/);
    assert.equal(body.evidence.account.stableBalance.source, "rpc.balance");
    assert.equal(body.derivation, undefined, "the bulky derivation is not sent");
    assert.ok(body.attribution.walletAgeDays);
  });

  it("a linked wallet without a proof comes back as a preview", async () => {
    const res = await createRouter(uw())(req({ json: { account: ACCOUNT.fresh, linked: { wallet: LINKED.strong } } }));
    const body = JSON.parse(res.body);
    assert.equal(body.final, false);
    assert.deepEqual(body.missing, ["linked.ownership"]);
    assert.equal(body.report, null);
    assert.equal(body.decision.limit, "1000000000", "the preview shows what linking would give");
  });

  it("validates input", async () => {
    const route = createRouter(uw());
    const cases: Array<[RouteRequest, number, string]> = [
      [req({ json: { account: "0x123" } }), 400, "invalid_field"],
      [req({ body: "{not json" }), 400, "invalid_json"],
      [req({ json: { account: ACCOUNT.fresh }, headers: { "content-type": "text/plain" } }), 415, "unsupported_media_type"],
      [req({ json: { account: ACCOUNT.fresh, purchase: "two hundred" } }), 400, "invalid_field"],
      [req({ json: { account: ACCOUNT.fresh, linked: { wallet: LINKED.strong, proof: { nonce: 1 } } } }), 400, "invalid_field"],
      [req({ method: "GET" }), 405, "method_not_allowed"],
      [req({ url: "/v1/nope" }), 404, "not_found"],
      [req({ body: "x".repeat(20_000) }), 413, "too_large"],
    ];
    for (const [r, code, err] of cases) {
      const res = await route(r);
      assert.equal(res.status, code, `${r.method} ${r.url} ${r.body.slice(0, 40)}`);
      assert.equal(JSON.parse(res.body).error.code, err);
    }
  });

  it("requires the bearer token when one is set", async () => {
    const route = createRouter(uw(), { token: "t0k3n" });
    assert.equal((await route(req({ json: { account: ACCOUNT.fresh } }))).status, 401);
    assert.equal((await route(req({ json: { account: ACCOUNT.fresh }, headers: { authorization: "Bearer wrong" } }))).status, 401);
    assert.equal((await route(req({ json: { account: ACCOUNT.fresh }, headers: { authorization: "Bearer t0k3n" } }))).status, 200);
    assert.equal((await route(req({ method: "GET", url: "/health" }))).status, 200, "health stays open");
  });

  it("answers CORS only for allowlisted origins, never *", async () => {
    const route = createRouter(uw(), { corsOrigins: ["https://app.polarispay.app"] });
    const ok = await route(req({ method: "OPTIONS", headers: { origin: "https://app.polarispay.app" } }));
    assert.equal(ok.status, 204);
    assert.equal(ok.headers["access-control-allow-origin"], "https://app.polarispay.app");
    const no = await route(req({ method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    assert.equal(no.headers["access-control-allow-origin"], undefined);
  });

  it("rate-limits underwriting per client, since each one spends Nansen credits", async () => {
    let t = 0;
    const route = createRouter(uw(), { rateLimitPerMinute: 2, now: () => t });
    const r = req({ json: { account: ACCOUNT.fresh } });
    assert.equal((await route(r)).status, 200);
    assert.equal((await route(r)).status, 200);
    assert.equal((await route(r)).status, 429);
    assert.equal((await route({ ...r, client: "other" })).status, 200);
    t = 60_001;
    assert.equal((await route(r)).status, 200);
  });

  it("POST /v1/explain: facts already on chain, or the report itself", async () => {
    const facts = { walletAgeDays: 730, txCount: 300, stableBalance: "1240000000", defiTenureDays: 0, priorLiquidations: 0, relatedWallets: 0, exchangeFunded: false, observedAt: String(NOW) };
    const route = createRouter(uw());
    const a = JSON.parse((await route(req({ url: "/v1/explain", json: { facts } }))).body);
    assert.equal(a.breakdown.score, 520 + 48 + 12 + 12);
    assert.ok(a.decision.reasons.some((r: { text: string }) => r.text === "You've used this account for 2 years · +48"));

    const report = encodeUnderwriteReport(ACCOUNT.fresh, { ...facts, stableBalance: 1_240_000_000n, observedAt: BigInt(NOW) });
    const b = JSON.parse((await route(req({ url: "/v1/explain", json: { report } }))).body);
    assert.equal(b.user, ACCOUNT.fresh);
    assert.equal(b.breakdown.score, a.breakdown.score);

    const bad = await route(req({ url: "/v1/explain", json: { facts: { ...facts, relatedWallets: 70_000 } } }));
    assert.equal(bad.status, 400);
  });

  it("GET /v1/link-message: the exact text to sign", async () => {
    const res = await createRouter(uw())(req({ method: "GET", url: `/v1/link-message?account=${ACCOUNT.fresh}&wallet=${LINKED.strong}&issuedAt=${NOW}&nonce=abcdef123` }));
    const { message } = JSON.parse(res.body);
    assert.match(message, /^Polaris: count this wallet's history toward my credit line\./);
    assert.match(message, /Issued: 2026-09-26T12:00:00Z/);
  });

  it("the Fetch adapter serves a Next.js route handler", async () => {
    const handle = createFetchHandler(uw());
    const res = await handle(new Request("http://app.local/v1/underwrite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: ACCOUNT.fresh }) }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { decision: { limit: string } }).decision.limit, "200000000");
  });
});

describe("the node:http server", () => {
  let server: Server;
  let url: string;
  before(async () => {
    ({ server, url } = await startUnderwritingServer({ port: 0, underwriter: uw() }));
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves the same API over a socket", async () => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    const res = await fetch(`${url}/v1/underwrite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: ACCOUNT.regular }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { facts: { walletAgeDays: number } };
    assert.equal(body.facts.walletAgeDays, 90);
    const big = await fetch(`${url}/v1/underwrite`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(40_000) });
    assert.equal(big.status, 413);
  });
});
