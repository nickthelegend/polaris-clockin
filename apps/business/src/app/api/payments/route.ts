import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { listPayments } from "@/server/services";

export const dynamic = "force-dynamic";

/** Every payment, newest first. "Succeeded" only ever comes from indexed chain events. */
export const GET = withMerchant(async (_req, auth) => ok(await listPayments(auth)));
