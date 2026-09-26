import "server-only";

import { PrivyClient } from "@privy-io/node";

/**
 * The server's Privy client, created on first use.
 *
 * `@privy-io/node` (not the deprecated `@privy-io/server-auth`). It is built
 * lazily so that `next build` and the setup screen work with no Privy
 * credentials at all; a route that needs it gets `null` and answers 503.
 */

let client: PrivyClient | null | undefined;

export function privyServerConfig() {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  const appSecret = process.env.PRIVY_APP_SECRET || "";
  return { appId, appSecret, configured: Boolean(appId && appSecret) };
}

export function getPrivy(): PrivyClient | null {
  if (client !== undefined) return client;
  const { appId, appSecret, configured } = privyServerConfig();
  client = configured
    ? new PrivyClient({
        appId,
        appSecret,
        jwtVerificationKey: process.env.PRIVY_VERIFICATION_KEY || undefined,
      })
    : null;
  return client;
}
