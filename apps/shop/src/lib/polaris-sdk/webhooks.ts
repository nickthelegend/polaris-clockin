import { createHmac, timingSafeEqual } from "node:crypto";

import { PolarisSignatureVerificationError } from "./errors";
import { POLARIS_EVENT_TYPES, type PolarisEvent } from "./types";

/**
 * Webhook signatures, Stripe-style. Every delivery carries
 *
 *   Polaris-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.rawBody">
 *
 * Signing the timestamp with the body is what stops a captured delivery being
 * replayed later: verify() refuses a timestamp outside the tolerance. Several
 * v1 entries may appear while a secret is being rolled; any one may match.
 * Delivery is at least once, so receivers still dedupe on `event.id`.
 */

export const SIGNATURE_HEADER = "polaris-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerifyOptions = {
  /** Seconds either side of now a signature stays valid. Default 300. */
  toleranceSeconds?: number;
  /** Unix seconds; for tests. */
  now?: number;
};

type RawBody = string | Uint8Array;

function bodyText(rawBody: RawBody): string {
  return typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
}

export function computeSignature(secret: string, timestamp: number, rawBody: RawBody): string {
  return createHmac("sha256", secret).update(`${timestamp}.${bodyText(rawBody)}`).digest("hex");
}

/** Build a valid header for a payload: for tests and for anything that sends events (the dev mock). */
export function generateTestHeader({
  payload,
  secret,
  timestamp = Math.floor(Date.now() / 1000),
}: {
  payload: RawBody;
  secret: string;
  timestamp?: number;
}): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, payload)}`;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

function safeEqualHex(expected: string, provided: string): boolean {
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  // timingSafeEqual throws on unequal lengths; compare lengths first.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify a delivery against the raw request body (the exact bytes, before any
 * JSON parsing) and return the event. Throws PolarisSignatureVerificationError
 * with a `reason` for logs; answer the sender with a bare 400.
 */
export function verify(
  rawBody: RawBody,
  header: string | null | undefined,
  secret: string,
  options: VerifyOptions = {},
): PolarisEvent {
  if (!secret) throw new PolarisSignatureVerificationError("missing_secret", "No webhook signing secret was configured.");
  if (!header) throw new PolarisSignatureVerificationError("missing_header", "The Polaris-Signature header is missing.");

  const { timestamp, signatures } = parseHeader(header);
  if (!Number.isFinite(timestamp)) {
    throw new PolarisSignatureVerificationError("malformed_header", "The Polaris-Signature header has no timestamp.");
  }
  if (signatures.length === 0) {
    throw new PolarisSignatureVerificationError("no_signatures", "The Polaris-Signature header has no v1 signature.");
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new PolarisSignatureVerificationError(
      "timestamp_outside_tolerance",
      `The signature's timestamp is ${now - timestamp}s from now, outside the ${tolerance}s tolerance.`,
    );
  }

  const expected = computeSignature(secret, timestamp, rawBody);
  if (!signatures.some((candidate) => safeEqualHex(expected, candidate))) {
    throw new PolarisSignatureVerificationError("signature_mismatch", "No signature in the header matches the body.");
  }

  let event: unknown;
  try {
    event = JSON.parse(bodyText(rawBody));
  } catch {
    throw new PolarisSignatureVerificationError("invalid_payload", "The body is signed but is not JSON.");
  }
  if (!isEvent(event)) {
    throw new PolarisSignatureVerificationError("invalid_payload", "The body is signed but is not a Polaris event.");
  }
  return event;
}

function isEvent(value: unknown): value is PolarisEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    (POLARIS_EVENT_TYPES as readonly string[]).includes(event.type) &&
    typeof event.data === "object" &&
    event.data !== null
  );
}
