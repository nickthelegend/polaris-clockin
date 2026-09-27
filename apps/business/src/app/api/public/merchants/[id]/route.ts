import { withPublic } from "@/server/auth";
import { getDb } from "@/server/db";
import { HttpError, ok } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A merchant's public profile: the `metadataURI` their MerchantRegistry entry points at. */
export const GET = withPublic<Ctx>(async (_req, _auth, { params }) => {
  const { id } = await params;
  const merchant = /^mer_[A-Za-z0-9]{8,64}$/.test(id) ? await getDb().merchants.findOne({ publicId: id }) : null;
  if (!merchant) throw new HttpError(404, "not_found", "No such merchant.");
  return ok({ id: merchant.publicId, name: merchant.businessName, payoutAddress: merchant.walletAddress, since: merchant.createdAt });
});
