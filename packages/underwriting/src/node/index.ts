/**
 * `@polarispay/underwriting`: the pure core plus the Node side (provider
 * clients, the evidence collector, the service and the HTTP handler).
 *
 * For the CRE workflow import `@polarispay/underwriting/core` instead: it has
 * no Node dependency.
 */

export * from "../core/index.ts";

export {
  fetchTransport,
  send,
  RateLimiter,
  TtlCache,
  ProviderError,
  DEFAULT_RETRY,
  systemClock,
  retryAfterMs,
  type Clock,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  type RetryPolicy,
  type ProviderErrorCode,
} from "./http.ts";
export { fixtureTransport, fixtureResponse, locateFixture, DEFAULT_FIXTURES_DIR, type FixtureFile } from "./fixtures.ts";
export type { ClientOptions } from "./client.ts";
export { NansenClient } from "./nansen.ts";
export { ZerionClient } from "./zerion.ts";
export { EtherscanClient } from "./etherscan.ts";
export { RpcClient } from "./rpc.ts";
export { collectAccount, collectLinked, sender, type Providers, type CollectOptions } from "./collect.ts";
export {
  Underwriter,
  CreditMeter,
  verifyLinkProof,
  SERVICE_VERSION,
  type AssessRequest,
  type Assessment,
  type UnderwriterOptions,
} from "./service.ts";
export { createRouter, createNodeHandler, createFetchHandler, type HandlerOptions, type RouteRequest, type RouteResponse } from "./handler.ts";
export { startUnderwritingServer, type ServerOptions } from "./server.ts";
