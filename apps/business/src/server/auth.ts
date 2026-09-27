import "server-only";

import { getAddress, isAddress } from "viem";

import type { Address } from "@/lib/data/types";
import { fail, HttpError } from "./http";
import { getPrivy } from "./privy";
import { takeWriteToken } from "./rate-limit";

/**
 * Who is calling, proven by Privy.
 *
 * The old merchant platform read the merchant's wallet from an
 * `x-wallet-address` header, so anyone could read any merchant's book by
 * sending someone else's address. Here the only input is the Privy access
 * token: we verify its signature, take the user ID from its claims, and look
 * the embedded wallet up from Privy ourselves. A header, a query string or a
 * body can never name the merchant or their wallet.
 */

export type AuthedMerchant = {
  /** The Privy user ID (`did:privy:...`). */
  userId: string;
  /** The user's Privy embedded wallet. Null in the moment between login and wallet creation. */
  walletAddress: Address | null;
  email: string | null;
  sessionId: string;
};

type TokenSource = "header" | "cookie";

const COOKIE_NAME = "privy-token";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readToken(req: Request): { token: string; source: TokenSource } | null {
  const header = req.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match?.[1] ? { token: match[1], source: "header" } : null;
  }
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return value ? { token: value, source: "cookie" } : null;
  }
  return null;
}

/**
 * A cookie rides along on cross-site requests; a Bearer header can't. When the
 * token came from the cookie, refuse a state-changing request that another
 * site could have forged.
 */
function assertSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin") return;
    throw new HttpError(403, "cross_site", "This request came from another site and was refused.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === new URL(req.url).host) return;
    } catch {
      // "null" or a malformed origin: fall through and refuse.
    }
  }
  throw new HttpError(403, "cross_site", "This request came from another site and was refused.");
}

/* ── The embedded wallet, looked up from Privy and cached briefly ──────── */

type Profile = { walletAddress: Address | null; email: string | null };
const profiles = new Map<string, { value: Profile; expires: number }>();
const PROFILE_TTL_MS = 5 * 60_000;
/** Before the wallet exists, look again soon: it is created right after login. */
const PENDING_TTL_MS = 10_000;
const MAX_CACHED = 5_000;

type LinkedAccount = {
  type?: string;
  address?: string;
  email?: string;
  chain_type?: string;
  connector_type?: string;
  wallet_client_type?: string;
};

function profileFrom(accounts: readonly LinkedAccount[]): Profile {
  let walletAddress: Address | null = null;
  let email: string | null = null;
  for (const account of accounts) {
    const embedded =
      account.type === "wallet" &&
      account.chain_type === "ethereum" &&
      (account.connector_type === "embedded" || account.wallet_client_type === "privy");
    if (embedded && !walletAddress && account.address && isAddress(account.address)) {
      walletAddress = getAddress(account.address);
    }
    if (!email && account.type === "email" && account.address) email = account.address;
    if (!email && account.type === "google_oauth" && account.email) email = account.email;
  }
  return { walletAddress, email };
}

async function lookupProfile(userId: string): Promise<Profile> {
  const cached = profiles.get(userId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const privy = getPrivy();
  if (!privy) throw new HttpError(503, "auth_not_configured", "Sign-in isn't configured on this server.");

  let accounts: readonly LinkedAccount[];
  try {
    const user = await privy.users()._get(userId);
    accounts = (user.linked_accounts ?? []) as readonly LinkedAccount[];
  } catch (error) {
    const status = privyStatus(error);
    // A valid token for a user Privy no longer has (deleted): the session is over.
    if (status === 404) throw new HttpError(401, "invalid_token", "Your session has expired. Sign in again.");
    // Privy refused our app secret: a server configuration problem, not the merchant's.
    if (status === 401 || status === 403) {
      console.error("[auth] Privy rejected the app credentials while loading a user", status);
      throw new HttpError(503, "auth_not_configured", "Sign-in isn't configured correctly on this server.");
    }
    throw new HttpError(502, "privy_unavailable", "We couldn't reach Privy to load your account. Try again.");
  }

  const value = profileFrom(accounts);
  if (profiles.size >= MAX_CACHED) profiles.clear();
  profiles.set(userId, { value, expires: Date.now() + (value.walletAddress ? PROFILE_TTL_MS : PENDING_TTL_MS) });
  return value;
}

/** The HTTP status of a failed Privy API call, when it had one. */
function privyStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Verify the request's Privy access token (`Authorization: Bearer` or the
 * `privy-token` cookie) and return the merchant it belongs to. Throws an
 * `HttpError` (401, 403, 502 or 503) otherwise.
 */
export async function authenticate(req: Request): Promise<AuthedMerchant> {
  const privy = getPrivy();
  if (!privy) throw new HttpError(503, "auth_not_configured", "Sign-in isn't configured on this server.");

  const found = readToken(req);
  if (!found) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  if (found.source === "cookie" && UNSAFE_METHODS.has(req.method.toUpperCase())) assertSameOrigin(req);

  let userId: string;
  let sessionId: string;
  try {
    // @privy-io/node 0.35: takes the token string, returns snake_case claims.
    const claims = await privy.utils().auth().verifyAccessToken(found.token);
    userId = claims.user_id;
    sessionId = claims.session_id;
  } catch {
    throw new HttpError(401, "invalid_token", "Your session has expired. Sign in again.");
  }
  if (!userId) throw new HttpError(401, "invalid_token", "Your session has expired. Sign in again.");

  const profile = await lookupProfile(userId);
  return { userId, sessionId, ...profile };
}

/**
 * Wrap a route handler so it only ever runs for a verified merchant.
 *
 * Every handler under `app/api` is exported through this; `pnpm lint` fails
 * the build if one isn't (scripts/check-api-auth.mjs).
 */
export function withMerchant<Ctx = unknown>(
  handler: (req: Request, merchant: AuthedMerchant, ctx: Ctx) => Promise<Response>,
) {
  return async function authenticated(req: Request, ctx: Ctx): Promise<Response> {
    try {
      const merchant = await authenticate(req);
      if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
        const wait = takeWriteToken(merchant.userId);
        if (wait > 0) {
          return fail(429, "rate_limited", "That's a lot of changes at once. Wait a moment and try again.", {
            "Retry-After": String(wait),
          });
        }
      }
      return await handler(req, merchant, ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        const headers: HeadersInit | undefined =
          error.status === 401 ? { "WWW-Authenticate": 'Bearer realm="polaris-business"' } : undefined;
        return fail(error.status, error.code, error.message, headers, error.field);
      }
      console.error("[api] unhandled error", error);
      return fail(500, "internal", "Something went wrong on our side. Try again.");
    }
  };
}

/** For routes that need the payout wallet to exist before they can act. */
export function requireWallet(merchant: AuthedMerchant): Address {
  if (!merchant.walletAddress) {
    throw new HttpError(409, "wallet_pending", "Your payout account is still being set up. Try again in a moment.");
  }
  return merchant.walletAddress;
}
