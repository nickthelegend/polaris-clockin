import "server-only";

import { getAddress, isAddress, zeroAddress } from "viem";

import {
  WEBHOOK_EVENTS,
  type Address,
  type AutoPayoutsInput,
  type CreateApiKeyInput,
  type CreateLinkInput,
  type CreateWebhookInput,
  type LinkUsage,
  type PayMode,
  type WebhookEventType,
  type WithdrawInput,
} from "@/lib/data/types";
import { HttpError } from "./http";

/**
 * Request validation. Each function takes the parsed JSON body and returns a
 * typed input or throws a 400 whose message names the field and the fix.
 */

function invalid(message: string): never {
  throw new HttpError(400, "invalid_request", message);
}

function text(body: Record<string, unknown>, key: string, { min = 1, max = 200 } = {}): string {
  const value = body[key];
  if (typeof value !== "string") invalid(`${key} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min) invalid(`${key} is required.`);
  if (trimmed.length > max) invalid(`${key} must be ${max} characters or fewer.`);
  // No control characters: these end up in receipts, webhooks and logs.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) invalid(`${key} contains characters we can't use.`);
  return trimmed;
}

/** Whole cents, $1.00 to $1,000,000.00 unless a tighter cap applies. */
function cents(body: Record<string, unknown>, key: string, { min = 100, max = 100_000_000 } = {}): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${key} must be a whole number of cents.`);
  if (value < min) invalid(`The amount must be at least $${(min / 100).toFixed(2)}.`);
  if (value > max) invalid(`The amount can be at most $${(max / 100).toLocaleString("en-US")}.`);
  return value;
}

export function address(value: unknown, label = "address"): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    invalid(`Enter a valid ${label}: 0x followed by 40 hexadecimal characters.`);
  }
  const checksummed = getAddress(value);
  if (checksummed === zeroAddress) invalid(`The zero address can't receive money.`);
  return checksummed;
}

const MODES: readonly PayMode[] = ["now", "later", "subscribe"];
const USAGES: readonly LinkUsage[] = ["single", "reusable"];
/** A link can live up to a year; null means it never expires. */
const MAX_EXPIRY_HOURS = 24 * 365;

export function parseBusinessName(body: Record<string, unknown>): { businessName: string } {
  return { businessName: text(body, "businessName", { min: 2, max: 80 }) };
}

export function parseCreateLink(body: Record<string, unknown>): CreateLinkInput {
  const amountCents = cents(body, "amountCents");
  const description = text(body, "description", { max: 120 });

  const rawModes = body.modes;
  if (!Array.isArray(rawModes) || rawModes.length === 0) invalid("Choose at least one way to pay.");
  const modes = [...new Set(rawModes)] as PayMode[];
  if (!modes.every((m) => MODES.includes(m))) invalid("modes may only contain now, later and subscribe.");
  // Pay in 4 has a floor: below $20 the instalments round to nothing useful.
  if (modes.includes("later") && amountCents < 20_00) invalid("Pay in 4 needs an amount of at least $20.00.");

  const usage = body.usage as LinkUsage;
  if (!USAGES.includes(usage)) invalid("usage must be single or reusable.");

  const expires = body.expiresInHours;
  let expiresInHours: number | null = null;
  if (expires !== null && expires !== undefined) {
    if (typeof expires !== "number" || !Number.isInteger(expires) || expires < 1 || expires > MAX_EXPIRY_HOURS) {
      invalid("expiresInHours must be a whole number of hours between 1 and 8760, or null.");
    }
    expiresInHours = expires;
  }

  return { amountCents, description, modes: MODES.filter((m) => modes.includes(m)), usage, expiresInHours };
}

export function parseWithdraw(body: Record<string, unknown>): WithdrawInput {
  const amountCents = cents(body, "amountCents", { min: 1 });
  const destination = address(body.destination, "destination address");

  const auth = body.authorization;
  if (auth === undefined || auth === null) return { amountCents, destination };
  if (typeof auth !== "object" || Array.isArray(auth)) invalid("authorization must be an object.");
  const a = auth as Record<string, unknown>;
  const uint = (k: string) => {
    const v = a[k];
    if (typeof v !== "string" || !/^\d{1,20}$/.test(v)) invalid(`authorization.${k} must be a decimal string.`);
    return v;
  };
  const hex = (k: string, bytes?: number) => {
    const v = a[k];
    const pattern = bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x[0-9a-fA-F]+$/;
    if (typeof v !== "string" || !pattern.test(v)) invalid(`authorization.${k} is malformed.`);
    return v as `0x${string}`;
  };
  return {
    amountCents,
    destination,
    authorization: {
      validAfter: uint("validAfter"),
      validBefore: uint("validBefore"),
      nonce: hex("nonce", 32),
      signature: hex("signature"),
    },
  };
}

export function parseAutoPayouts(body: Record<string, unknown>): AutoPayoutsInput {
  if (typeof body.enabled !== "boolean") invalid("enabled must be true or false.");
  const payoutAddress =
    body.payoutAddress === null || body.payoutAddress === undefined || body.payoutAddress === ""
      ? null
      : address(body.payoutAddress, "payout address");
  if (body.enabled && !payoutAddress) invalid("Add a payout address before turning on automatic payouts.");
  return { enabled: body.enabled, payoutAddress };
}

export function parseCreateApiKey(body: Record<string, unknown>): CreateApiKeyInput {
  return { name: text(body, "name", { max: 60 }) };
}

export function parseCreateWebhook(body: Record<string, unknown>): CreateWebhookInput {
  const raw = text(body, "url", { max: 500 });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid("Enter the full endpoint URL, starting with https://.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:" && process.env.NODE_ENV !== "production")) {
    invalid("Webhook endpoints must use https://.");
  }
  if (url.username || url.password) invalid("Put credentials in your receiver, not in the URL.");

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) invalid("Choose at least one event.");
  const events = [...new Set(rawEvents)] as WebhookEventType[];
  if (!events.every((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e))) invalid("One of the events isn't one we send.");

  return { url: url.toString(), events: WEBHOOK_EVENTS.filter((e) => events.includes(e)) };
}
