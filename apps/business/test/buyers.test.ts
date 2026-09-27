import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as buyerGet } from "@/app/api/public/buyers/[address]/route";
import { POST as relayRoute } from "@/app/api/relay/route";

import { json, params, request, setupServer } from "./helpers/env";
import { emitLikeTheContracts, merchantWithKeys, newSession, signPayNow, type Merchant } from "./helpers/flows";

let merchant: Merchant;
const buyer = privateKeyToAccount(generatePrivateKey());

beforeEach(async () => {
  const env = setupServer();
  emitLikeTheContracts(env);
  merchant = await merchantWithKeys();
});

const book = async (address: string) => (await json(await buyerGet(request("GET", `/api/public/buyers/${address}`), params({ address })))).body.data;

describe("GET /api/public/buyers/{address}", () => {
  it("shows a buyer's payments from chain events, with the merchant's name but never the checkout's description or order", async () => {
    const session = await newSession(merchant, { description: "Private consultation for J. Doe", orderId: "INV-secret-42" });
    const auth = await signPayNow(buyer, merchant.account.address, session.orderId, 200_000_000n);
    expect((await relayRoute(request("POST", "/api/relay", { body: { type: "pay", sessionId: session.id, buyer: buyer.address, ...auth } }), params({}))).status).toBe(200);

    const mine = await book(buyer.address);
    expect(mine.payments).toHaveLength(1);
    expect(mine.payments[0]).toMatchObject({ kind: "now", amountUnits: "200000000", merchant: { address: merchant.account.address } });
    expect(mine.payments[0].txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const text = JSON.stringify(mine);
    expect(text).not.toContain("Private consultation");
    expect(text).not.toContain("INV-secret-42");

    // Someone else's address shows nothing of it; the lookup is case-insensitive.
    expect((await book(privateKeyToAccount(generatePrivateKey()).address)).payments).toEqual([]);
    expect((await book(buyer.address.toLowerCase())).payments).toHaveLength(1);
  });

  it("refuses something that isn't an address", async () => {
    const res = await buyerGet(request("GET", "/api/public/buyers/nope"), params({ address: "nope" }));
    expect(res.status).toBe(400);
  });
});
