import "server-only";

/**
 * One response shape for every route: `{ data }` on success, `{ error: { code,
 * message, field? } }` on failure. The message is written for the person using
 * the dashboard; the code is for the client to branch on; `field` names the
 * request field a validation error is about, so a form can mark it.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, code: string, message: string, headers?: HeadersInit, field?: string): Response {
  return Response.json(
    { error: field ? { code, message, field } : { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

/**
 * A handler for a method the route doesn't support: a JSON 405 with `Allow`,
 * instead of Next's empty body. Export it through withMerchant like any other.
 */
export function methodNotAllowed(allowed: readonly string[]) {
  return async function notAllowed(): Promise<Response> {
    return fail(405, "method_not_allowed", `This endpoint accepts ${allowed.join(" and ")} only.`, {
      Allow: allowed.join(", "),
    });
  };
}

const MAX_BODY_BYTES = 16 * 1024;

/** Parse a JSON object body, refusing anything large, malformed or not an object. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Send the request body as JSON.");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "The request body is too large.");

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "The request body is too large.");

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
