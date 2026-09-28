/**
 * What every provider client shares: live or fixture mode, retries, the rate
 * limiter, the cache, and the credit log.
 */

import type { DataMode } from "../core/types.ts";
import type { RequestSpec } from "../core/providers/common.ts";
import { DEFAULT_FIXTURES_DIR, fixtureTransport } from "./fixtures.ts";
import {
  fetchTransport,
  RateLimiter,
  send,
  systemClock,
  TtlCache,
  type Clock,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  type RetryPolicy,
} from "./http.ts";

export interface ClientOptions {
  /** A key makes the client live; without one it reads fixtures. */
  apiKey?: string;
  /** Force a mode. `live` without a key sends unauthenticated requests. */
  mode?: DataMode;
  fixturesDir?: string;
  /** Replace the transport entirely (tests). */
  transport?: HttpTransport;
  retry?: Partial<RetryPolicy>;
  clock?: Clock;
  /** Minimum gap between request starts. */
  minIntervalMs?: number;
  /** How long successful responses are reused. 0 disables. Default 10 minutes, CRE's cache cap. */
  cacheTtlMs?: number;
  random?: () => number;
  /** Observes every response, for credit accounting and logs. */
  onResponse?: (spec: RequestSpec, res: HttpResponse, attempt: number) => void;
}

export abstract class ProviderClient {
  readonly mode: DataMode;
  protected readonly apiKey: string | undefined;
  private readonly transport: HttpTransport;
  private readonly limiter: RateLimiter;
  private readonly cache: TtlCache;
  private readonly opts: ClientOptions;

  protected constructor(opts: ClientOptions, defaults: { minIntervalMs: number }) {
    this.opts = opts;
    this.apiKey = opts.apiKey && opts.apiKey.trim() !== "" ? opts.apiKey.trim() : undefined;
    this.mode = opts.mode ?? (this.apiKey ? "live" : "fixture");
    const clock = opts.clock ?? systemClock;
    this.transport =
      opts.transport ?? (this.mode === "live" ? fetchTransport : fixtureTransport(opts.fixturesDir ?? DEFAULT_FIXTURES_DIR));
    this.limiter = new RateLimiter(opts.minIntervalMs ?? (this.mode === "live" ? defaults.minIntervalMs : 0), clock);
    this.cache = new TtlCache(opts.cacheTtlMs ?? 10 * 60_000, clock);
  }

  /** Add this provider's secret to a request. Fixture mode never sees the key. */
  protected abstract authorize(req: HttpRequest): HttpRequest;

  /** Send a request built by the core (a recipe step): authorized, retried, rate-limited, cached. */
  execute(spec: RequestSpec): Promise<HttpResponse> {
    return this.request(spec);
  }

  protected request(spec: RequestSpec): Promise<HttpResponse> {
    return send(spec, {
      transport: this.transport,
      retry: this.opts.retry,
      clock: this.opts.clock,
      limiter: this.limiter,
      cache: this.cache,
      random: this.opts.random,
      onResponse: this.opts.onResponse,
      authorize: this.mode === "live" && this.apiKey ? (r) => this.authorize(r) : undefined,
    });
  }
}
