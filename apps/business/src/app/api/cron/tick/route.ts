import { withCron } from "@/server/auth";
import { ok } from "@/server/http";
import { runTick } from "@/server/workers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One pass of the background work (chain sync, late receipts, webhook
 * deliveries and retries, automatic payouts), for schedulers.
 * `Authorization: Bearer <CRON_SECRET>`; GET for Vercel Cron, POST for others.
 */
export const GET = withCron(async () => ok(await runTick()));
export const POST = withCron(async () => ok(await runTick()));
