import { withMerchant } from "@/server/auth";
import { ok } from "@/server/http";
import { listPlans } from "@/server/services";

export const dynamic = "force-dynamic";

/** The Pay in 4 ledger: every plan this merchant originated, from PlanOpened and the instalment events. */
export const GET = withMerchant(async (_req, auth) => ok(await listPlans(auth)));
