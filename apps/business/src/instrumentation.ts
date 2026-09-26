/**
 * Next.js calls `register` once per server process. On the Node runtime it
 * starts the background loops (chain sync, late receipts, webhook retries,
 * automatic payouts) unless POLARIS_WORKERS=0; serverless deployments use
 * `/api/cron/tick` instead. A misconfiguration is logged, never fatal: the
 * dashboard and the API still start, and /api/health says what's missing.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.POLARIS_WORKERS === "0") return;
  try {
    const { startWorkers } = await import("./server/workers");
    startWorkers();
  } catch (error) {
    console.error("[workers] not started:", (error as Error).message);
  }
}
