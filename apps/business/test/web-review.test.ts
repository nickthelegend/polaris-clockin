import type { MerchantRecord } from "@polaris/db";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as health, POST as healthPost } from "@/app/api/health/route";
import { GET as listLinks, POST as createLink } from "@/app/api/links/route";
import { PATCH as updateLink } from "@/app/api/links/[id]/route";
import { GET as me } from "@/app/api/me/route";
import { GET as overview } from "@/app/api/overview/route";
import { GET as payoutsGet, POST as withdraw } from "@/app/api/payouts/route";
import { POST as automatic } from "@/app/api/payouts/automatic/route";
import { GET as relayGet } from "@/app/api/relay/route";
import { readToken } from "@/server/auth";
import { getDb } from "@/server/db";
import { resetConfig } from "@/server/env";
import { safeNext } from "@/lib/next-path";

import { DEPLOYMENT, json, params, request, setupServer, signIn, type TestEnv } from "./helpers/env";

/**
 * The web review's server findings: sample is a live condition, links that
 * can't work are refused, the health route keeps its problems private, a bad
 * cookie is a 401, and unsupported methods answer in JSON.
 */

const WALLET = "0x2222222222222222222222222222222222222222";
const DESTINATION = "0x3333333333333333333333333333333333333333";
const LINK = { amountCents: 30_00, description: "Monthly box", modes: ["subscribe"], usage: "single", expiresInHours: null };

let env: TestEnv;

beforeEach(() => {
  env = setupServer();
  signIn({ userId: "did:privy:review", walletAddress: WALLET });
});

describe("sample data", () => {
  it("ends when the server is connected to a chain, between two requests", async () => {
    setupServer({ POLARIS_DEPLOYMENT_FILE: "does-not-exist.json", RELAYER_MODE: "off" });
    signIn({ userId: "did:privy:review", walletAddress: WALLET });
    const before = await json(await me(request("GET", "/api/me"), params({})));
    expect(before.body.data.sample).toBe(true);

    // A sample withdrawal, recorded against the sample balance.
    const sampleOut = await json(await withdraw(request("POST", "/api/payouts", { body: { amountCents: 100, destination: DESTINATION } }), params({})));
    expect(sampleOut.status).toBe(201);

    // Connect the chain and reload the config: no restart, no new merchant.
    process.env.POLARIS_DEPLOYMENT_FILE = DEPLOYMENT;
    process.env.RELAYER_MODE = "local";
    resetConfig();

    const after = await json(await overview(request("GET", "/api/overview"), params({})));
    expect(after.body.data.sample).toBe(false);
    expect(after.body.data.merchant.sample).toBe(false);

    const payouts = await json(await payoutsGet(request("GET", "/api/payouts"), params({})));
    expect(payouts.body.data.history).toHaveLength(0);

    // A real withdrawal now needs the payout wallet's signature.
    const unsigned = await json(await withdraw(request("POST", "/api/payouts", { body: { amountCents: 100, destination: DESTINATION } }), params({})));
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.error.code).toBe("signature_required");
  });

  it("marks every sample link, and a sample link can't be turned off (409, not 404)", async () => {
    setupServer({ POLARIS_DEPLOYMENT_FILE: "does-not-exist.json", RELAYER_MODE: "off" });
    signIn({ userId: "did:privy:review", walletAddress: WALLET });
    await createLink(request("POST", "/api/links", { body: { ...LINK, modes: ["now"] } }), params({}));
    const links = await json(await listLinks(request("GET", "/api/links"), params({})));
    const rows = links.body.data as { id: string; sample?: boolean }[];
    expect(rows.filter((l) => !l.sample)).toHaveLength(1);
    const sample = rows.find((l) => l.sample)!;
    expect(sample).toBeTruthy();

    const off = await json(await updateLink(request("PATCH", `/api/links/${sample.id}`, { body: { active: false } }), params({ id: sample.id })));
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe("sample_data");
  });
});

describe("links", () => {
  it("refuse a single-use subscription: it would be charged once", async () => {
    const res = await json(await createLink(request("POST", "/api/links", { body: LINK }), params({})));
    expect(res.status).toBe(400);
    expect(res.body.error.param).toBe("usage");
  });

  it("count only active links against the cap", async () => {
    const db = getDb();
    const { ensureMerchant } = await import("@/server/merchants");
    const merchant = await ensureMerchant({ userId: "did:privy:review", walletAddress: WALLET, walletId: null, email: null, sessionId: "s" });
    const now = new Date().toISOString();
    for (let i = 0; i < 500; i++) {
      await db.links.insert({
        id: `pl_cap${i}`,
        merchantId: merchant.id,
        url: "",
        amountCents: 100,
        description: "x",
        modes: ["now"],
        usage: "reusable",
        expiresAt: null,
        status: i < 10 ? "inactive" : "active",
        paymentsCount: 0,
        collectedCents: 0,
        createdAt: now,
      });
    }
    const body = { ...LINK, modes: ["now"], usage: "reusable" };
    for (let i = 0; i < 10; i++) {
      const res = await createLink(request("POST", "/api/links", { body }), params({}));
      expect(res.status).toBe(201);
    }
    const over = await json(await createLink(request("POST", "/api/links", { body }), params({})));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("limit_reached");
  });
});

describe("registration", () => {
  it("left at submitted moves on when the registry shows it", async () => {
    const { ensureMerchant } = await import("@/server/merchants");
    const merchant = await ensureMerchant({ userId: "did:privy:review", walletAddress: WALLET, walletId: null, email: null, sessionId: "s" });
    await getDb().merchants.update(merchant.id, (m: MerchantRecord) => ({ ...m, registration: { ...m.registration, state: "submitted" } }));
    env.chain.reads.merchantOf = () => ({ payoutAddress: WALLET, name: "", registeredAt: 1n, active: false, maxOrderValue: 0n });

    const res = await json(await me(request("GET", "/api/me"), params({})));
    expect(res.body.data.registration.state).toBe("registered");
  });
});

describe("automatic payouts", () => {
  it("turn off without the wallet", async () => {
    signIn({ userId: "did:privy:no-wallet", walletAddress: null });
    const res = await json(await automatic(request("POST", "/api/payouts/automatic", { body: { enabled: false } }), params({})));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
  });
});

describe("health", () => {
  it("says whether production is ready, not what's wrong", async () => {
    const res = await json(await health(request("GET", "/api/health"), params({})));
    expect(res.status).toBe(200);
    expect(res.body.data.problems).toBeUndefined();
    expect(typeof res.body.data.productionReady).toBe("boolean");
    expect(res.body.data.ready).toBeUndefined();
    expect(res.body.data.checkoutOrigin).toBe("http://localhost:3000");
  });

  it("has its own rate-limit bucket: checkout reads can't use it up", async () => {
    for (let i = 0; i < 75; i++) expect((await health(request("GET", "/api/health"), params({}))).status).toBe(200);
  });
});

describe("requests", () => {
  it("with a malformed privy-token cookie are unauthenticated, not a 500", () => {
    expect(readToken(new Request("http://localhost/api/me", { headers: { cookie: "privy-token=%" } }))).toBeNull();
    expect(readToken(new Request("http://localhost/api/me", { headers: { cookie: "privy-token=%E0%A4%A" } }))).toBeNull();
    expect(readToken(new Request("http://localhost/api/me", { headers: { cookie: "privy-token=abc" } }))).toEqual({ token: "abc", source: "cookie" });
  });

  it("with an unsupported method get a JSON 405 on the public and relay routes too", async () => {
    for (const res of [await healthPost(request("POST", "/api/health"), params({})), await relayGet(request("GET", "/api/relay"), params({}))]) {
      expect(res.status).toBe(405);
      expect((await res.json()).error.code).toBe("method_not_allowed");
    }
  });
});

describe("next", () => {
  it("stays in the dashboard after resolving dot segments", () => {
    expect(safeNext("/dashboard/../api/health")).toBe("/dashboard");
    expect(safeNext("/dashboard/../../evil")).toBe("/dashboard");
    expect(safeNext("/dashboard/links?new=1")).toBe("/dashboard/links?new=1");
    expect(safeNext("/payments")).toBe("/dashboard/payments");
  });
});
