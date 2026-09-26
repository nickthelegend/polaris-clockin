import "server-only";

import { randomBytes } from "node:crypto";

/**
 * One response shape for every route: `{ data }` on success, `{ error: {
 * code, message, param? } }` on failure. The message is written for the
 * person who will read it (a merchant in the dashboard, a buyer in the
 * checkout, a developer reading an SDK error); the code is for clients to
 * branch on; `param` names the offending field.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly param: string | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(status: number, code: string, message: string, options: { param?: string; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.param = options.param;
    this.headers = options.headers;
  }
}

export function ok<T>(data: T, status = 200, headers?: HeadersInit): Response {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function fail(status: number, code: string, message: string, headers?: HeadersInit, param?: string): Response {
  return Response.json(
    { error: param ? { code, message, param } : { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export function failFrom(error: HttpError): Response {
  return fail(error.status, error.code, error.message, error.headers, error.param);
}

/** `req_…`: returned as `Polaris-Request-Id` on every response, and logged with every error. */
export function newRequestId(): string {
  return `req_${randomBytes(12).toString("base64url")}`;
}

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

/** Parse a JSON object body, refusing anything large, malformed or not an object. */
export async function readJson(req: Request, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Send the request body as JSON (Content-Type: application/json).");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "too_large", "The request body is too large.");

  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, "too_large", "The request body is too large.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "The request body isn't valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_body", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/* ── CORS, for the routes a browser on another origin calls ─────────────── */

export type CorsPolicy = { kind: "any" } | { kind: "list"; origins: readonly string[] };

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Idempotency-Key, Polaris-Client";

/** The CORS headers for this request's Origin, or none when it isn't allowed. */
export function corsHeaders(req: Request, policy: CorsPolicy): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = policy.kind === "any" ? "*" : policy.origins.includes(origin) ? origin : null;
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": "Polaris-Request-Id, Retry-After",
    "Access-Control-Max-Age": "600",
    ...(policy.kind === "list" ? { Vary: "Origin" } : {}),
  };
}

export function preflight(req: Request, policy: CorsPolicy): Response {
  const headers = corsHeaders(req, policy);
  return new Response(null, { status: headers["Access-Control-Allow-Origin"] ? 204 : 403, headers });
}

/** The caller's IP, trusting X-Forwarded-For only behind a proxy we run. */
export function clientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "local";
}
