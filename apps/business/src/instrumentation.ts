/**
 * Next.js calls `register` once per server process. On the Node runtime it
 * starts the background loops (chain sync, late receipts, webhook retries,
 * automatic payouts) unless POLARIS_WORKERS=0; serverless deployments use
 * `/api/cron/tick` instead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.POLARIS_WORKERS === "0") return;
  const { startWorkers } = await import("./server/workers");
  try {
    startWorkers();
  } catch (error) {
    console.error("[workers] not started:", (error as Error).message);
  }
}
