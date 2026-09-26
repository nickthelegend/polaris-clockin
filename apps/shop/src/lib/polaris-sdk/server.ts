import { PolarisError, configurationError } from "./errors";
import { normaliseAmount } from "./money";
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  RequestOptions,
} from "./types";
import { generateTestHeader, verify, type VerifyOptions } from "./webhooks";

/**
 * Server half of polarispay-sdk 0.3.0: checkout sessions and webhooks.
 *
 *   POST {baseUrl}/api/v1/checkout/sessions      Authorization: Bearer sk_…
 *   GET  {baseUrl}/api/v1/checkout/sessions/:id
 */

export const SDK_VERSION = "0.3.0";
export const CLIENT_HEADER = `polarispay-sdk/${SDK_VERSION}`;
export const DEFAULT_BASE_URL = "https://api.polarispay.app";

export type PolarisServerOptions = {
  secretKey: string;
  baseUrl?: string;
  /** Retries after a 429, a 5xx or a network failure. Default 2. */
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const SECRET_KEY = /^sk_(test|live)_[A-Za-z0-9_]{8,}$/;

export function createPolarisServer(options: PolarisServerOptions) {
  const secretKey = options.secretKey?.trim();
  if (!secretKey) {
    throw configurationError("missing_secret_key", "createPolarisServer needs a secretKey (sk_test_… or sk_live_…).", "secretKey");
  }
  if (secretKey.startsWith("pk_")) {
    throw configurationError("publishable_key_on_server", "That is a publishable key (pk_…). The server needs the secret key (sk_…).", "secretKey");
  }
  if (!SECRET_KEY.test(secretKey)) {
    throw configurationError("invalid_secret_key", "secretKey doesn't look like a Polaris secret key (sk_test_… or sk_live_…).", "secretKey");
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  // Resolved per call, so a fetch patched after construction (tests, instrumentation) is used.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${secretKey}`,
      accept: "application/json",
      "polaris-client": CLIENT_HEADER,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    // A POST is only retried when it carries an idempotency key; otherwise a
    // retry after a lost response could create a second session.
    const retries = method === "GET" || idempotencyKey ? maxRetries : 0;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** (attempt - 1), 2000)));
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (cause) {
        lastError = new PolarisError(`Couldn't reach Polaris at ${baseUrl}.`, { type: "connection_error", code: "connection_failed", cause });
        continue;
      }
      const requestId = res.headers.get("polaris-request-id") ?? undefined;
      const payload = (await res.json().catch(() => null)) as
        | (T & { error?: undefined })
        | { error?: { type?: string; code?: string; message?: string; param?: string } }
        | null;
      if (res.ok && payload) return payload as T;

      const apiError = payload && "error" in payload ? payload.error : undefined;
      const error = new PolarisError(apiError?.message ?? `Polaris answered ${res.status}.`, {
        type: errorType(res.status, apiError?.type),
        code: apiError?.code ?? `http_${res.status}`,
        status: res.status,
        requestId,
        param: apiError?.param,
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = error;
        continue;
      }
      throw error;
    }
    throw lastError;
  }

  return {
    checkout: {
      sessions: {
        /** Create a hosted checkout session. Pass an idempotency key per order. */
        create(params: CheckoutSessionCreateParams, requestOptions: RequestOptions = {}): Promise<CheckoutSession> {
          const body: CheckoutSessionCreateParams = {
            ...params,
            amount: normaliseAmount(params.amount),
            lineItems: params.lineItems?.map((item) => ({ ...item, unitAmount: normaliseAmount(item.unitAmount, "lineItems.unitAmount") })),
          };
          return request<CheckoutSession>("POST", "/api/v1/checkout/sessions", body, requestOptions.idempotencyKey);
        },
        retrieve(id: string): Promise<CheckoutSession> {
          return request<CheckoutSession>("GET", `/api/v1/checkout/sessions/${encodeURIComponent(id)}`);
        },
      },
    },
    webhooks: {
      verify(rawBody: string | Uint8Array, signatureHeader: string | null | undefined, secret: string, verifyOptions?: VerifyOptions) {
        return verify(rawBody, signatureHeader, secret, verifyOptions);
      },
      generateTestHeader,
    },
  };
}

export type PolarisServer = ReturnType<typeof createPolarisServer>;

function errorType(status: number, apiType?: string): PolarisError["type"] {
  if (apiType === "idempotency_error" || status === 409) return "idempotency_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

export { verify as verifyWebhook, generateTestHeader } from "./webhooks";
export { PolarisError, PolarisSignatureVerificationError, isPolarisError } from "./errors";
export * from "./types";
