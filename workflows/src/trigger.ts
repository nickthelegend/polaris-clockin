/**
 * Firing the underwriting workflow from the Polaris API (Node, not WASM).
 *
 * Under simulation, `cre workflow simulate ./underwriting --listen --broadcast`
 * keeps a local server up and runs the workflow once per request to
 * `POST http://localhost:2000/trigger` with `{"input": <payload>}` (the CLI
 * source, v1.35.0; docs/research/cre.md §6.5 — the docs' bare-payload example
 * does not match the handler). It answers 200 as soon as the run is queued,
 * not with its result: the credit line reaches the app from the chain
 * (`UnderwritingApplied`, `ScoreManager.Underwritten`), never from this reply.
 *
 * The HTTP trigger fires at most once per 30 seconds per workflow, so the API
 * should queue requests rather than retry in a loop.
 *
 * A deployed workflow is fired through Chainlink's gateway with a JWT signed
 * by one of the workflow's `authorizedKeys`; that path needs Early Access and
 * is described in README.md, not implemented here.
 */

import { type UnderwritingPayload, underwritingPayloadSchema } from "./underwriting/payload.ts";

export const SIMULATOR_TRIGGER_URL = "http://localhost:2000/trigger";

export type TriggerResult = { queued: true } | { queued: false; status: number; message: string };

/** Queue one underwriting run on a `cre workflow simulate --listen` server. */
export async function triggerSimulatedUnderwriting(
  payload: UnderwritingPayload,
  opts: { url?: string; fetchImpl?: typeof fetch } = {},
): Promise<TriggerResult> {
  const input = underwritingPayloadSchema.parse(payload);
  const res = await (opts.fetchImpl ?? fetch)(opts.url ?? SIMULATOR_TRIGGER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (res.ok) return { queued: true };
  return { queued: false, status: res.status, message: (await res.text()).slice(0, 200) };
}
