import { env } from "./env";

/**
 * Calls to Polaris for Business: the relayer and the public checkout reads.
 * Every response is `{ data }` or `{ error: { code, message } }`; the message
 * is written for the buyer and is shown as is.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiConfigured(): boolean {
  return Boolean(env.apiUrl);
}

/**
 * The offline demo: no Polaris API, so balances, plans and activity are
 * sample data and the relayer is a local stub whose "transactions" never
 * reach a chain. Screens must say so, and never link a made-up hash to the
 * explorer.
 */
export const DEMO_MODE = !env.apiUrl;

export async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  if (!env.apiUrl) throw new ApiError(0, "not_configured", "Polaris isn't reachable from this build. Try again later.");
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      signal: init.signal ?? AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach Polaris. Check your connection; nothing was charged.");
  }
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !payload || !("data" in payload)) {
    throw new ApiError(res.status, payload?.error?.code ?? `http_${res.status}`, payload?.error?.message ?? "That didn't go through, and nothing was charged. Try again.");
  }
  return payload.data as T;
}
