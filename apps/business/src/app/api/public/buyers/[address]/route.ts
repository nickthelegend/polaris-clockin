import { getAddress, isAddress } from "viem";

import { withPreflight, withPublic } from "@/server/auth";
import { buyerBook } from "@/server/buyers";
import { HttpError, ok } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ address: string }> };

/**
 * What the Polaris app shows a buyer: their plans, subscriptions and payments
 * to Polaris merchants, from chain events. Only what the chain already shows
 * (src/server/buyers.ts): no descriptions, order ids or metadata.
 */
export const GET = withPublic<Ctx>(async (_req, _auth, { params }) => {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) throw new HttpError(400, "invalid_request", "address must be an address.", { param: "address" });
  return ok(await buyerBook(getAddress(address)));
});

export const OPTIONS = withPreflight("app");
