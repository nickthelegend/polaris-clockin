import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { getOverview } from "@/server/services";

export const dynamic = "force-dynamic";

/** Home: balance, today's payments, Pay in 4 exposure, collector and payout status. */
export const GET = withMerchant(async (_req, auth) => ok(await getOverview(auth)));
