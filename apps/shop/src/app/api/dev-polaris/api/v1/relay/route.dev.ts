import { after } from "next/server";

import { devMockEnabled, devMockInternalOrigin, notFound } from "@/lib/dev-polaris/guard";
import { apiError, deliver, mockKeys, relayPayment, type RelayRequest } from "@/lib/dev-polaris/mock";

export const dynamic = "force-dynamic";

/**
 * Dev mock of the Polaris relayer (polarispay-sdk's RelayPayRequest): checks
 * the buyer's ERC-3009 signature the way PolarisPayments.payWithAuthorization
 * would, submits nothing, and sends payment.succeeded to the store a moment
 * later, as the indexer would.
 */
export async function POST(req: Request) {
  if (!devMockEnabled()) return notFound();
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${mockKeys().publishableKey}`) {
    return apiError(401, "authentication_error", "invalid_api_key", "The relayer takes the publishable key.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_request_error", "invalid_json", "The body isn't JSON.");
  }
  const result = await relayPayment((body ?? {}) as Partial<RelayRequest>);
  if (!result.ok) return apiError(result.status, "invalid_request_error", result.code, result.message);
  // Never a Host the caller chose: signed events only ever go to this server.
  const webhookUrl = `${devMockInternalOrigin()}/api/webhooks/polaris`;
  after(async () => {
    // Monad finalises in under a second; the mock waits about that long.
    await new Promise((r) => setTimeout(r, 900));
    await deliver([result.event], webhookUrl);
  });
  // polarispay-sdk's RelayPayResponse. "confirmed": Monad finalises in under a second, so pay() needn't poll.
  return Response.json({ data: { txHash: result.txHash, status: "confirmed", paymentId: result.paymentId }, mock: true });
}
