/**
 * HTTP through CRE's HTTP capability: each node sends, the DON agrees on the
 * answer. `cacheSettings` lets one node make the call and the others reuse
 * its response (best effort, docs/research/cre.md §5.3), which keeps a paid
 * API from being charged once per node and keeps identical consensus stable
 * when the upstream changes between node calls.
 */

import {
  consensusIdenticalAggregation,
  cre,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { base64Utf8, SIGNATURE_HEADER, signCallback } from "./callback.ts";
import { nowSeconds } from "./evm.ts";

/**
 * POST a signed JSON callback to the Polaris API. Returns the HTTP status the
 * DON agreed on, or 0 when it could not be delivered; a callback never fails
 * a run, because the chain events already hold the truth and the API can
 * backfill from the indexer.
 */
export function postSignedCallback(
  runtime: Runtime<unknown>,
  p: { url: string; secret: string; payload: { id: string } & Record<string, unknown> },
): number {
  const body = JSON.stringify(p.payload);
  // DON time, so every node signs the same bytes and the cache can share one request.
  const signature = signCallback(p.secret, body, nowSeconds(runtime));
  const send = (req: HTTPSendRequester, url: string, payload: string, sig: string, key: string): number => {
    try {
      const res = req
        .sendRequest({
          url,
          method: "POST",
          body: base64Utf8(payload),
          multiHeaders: {
            "content-type": { values: ["application/json"] },
            [SIGNATURE_HEADER]: { values: [sig] },
            "idempotency-key": { values: [key] },
          },
          timeout: "10s",
          cacheSettings: { store: true, maxAge: "60s" },
        })
        .result();
      return res.statusCode;
    } catch {
      return 0;
    }
  };
  return new cre.capabilities.HTTPClient()
    .sendRequest(runtime, send, consensusIdenticalAggregation<number>().withDefault(0))(p.url, body, signature, p.payload.id)
    .result();
}

/** Read one secret, or null when it is not configured. */
export function optionalSecret(runtime: Runtime<unknown>, id: string | null | undefined): string | null {
  if (!id) return null;
  try {
    const value = runtime.getSecret({ id }).result().value;
    return value ? value : null;
  } catch {
    return null;
  }
}
