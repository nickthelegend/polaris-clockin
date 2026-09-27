"use client";

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { AuthContext, LOCAL_SESSION_TOKEN, type AuthState } from "@/lib/auth-context";

/** The demo merchant's address, for display (the server takes it from its own config, never from here). */
const LOCAL_SESSION_WALLET = /^0x[0-9a-fA-F]{40}$/.test(process.env.NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET ?? "")
  ? (process.env.NEXT_PUBLIC_POLARIS_LOCAL_SESSION_WALLET as `0x${string}`)
  : null;

const SIGNED_OUT_KEY = "polaris:local-session-signed-out";
const listeners = new Set<() => void>();

function readSignedOut(): boolean {
  try {
    return window.sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSignedOut(out: boolean) {
  try {
    if (out) window.sessionStorage.setItem(SIGNED_OUT_KEY, "1");
    else window.sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * DEVELOPMENT ONLY: `pnpm demo:local`'s signed-in dashboard. Unlike the mock
 * session it reads and writes the real API, as the demo merchant on the local
 * chain: the server accepts this run's random token only there (server/auth.ts
 * `localSession`). The merchant's wallet is the deploy script's demo merchant,
 * whose key the browser doesn't hold, so anything that needs its signature
 * (withdraw, automatic payouts) says so instead.
 */
export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const signedOut = useSyncExternalStore<boolean | null>(subscribe, readSignedOut, () => null);
  const login = useCallback(() => writeSignedOut(false), []);
  const logout = useCallback(async () => writeSignedOut(true), []);

  const value = useMemo<AuthState>(() => {
    const unavailable = async (): Promise<never> => {
      throw new Error("The local demo session can't sign with the merchant's wallet. Sign in with Privy to withdraw.");
    };
    return {
      status: signedOut === null ? "loading" : signedOut ? "signed-out" : "signed-in",
      user: signedOut === false ? { id: "local-demo-merchant", email: null } : null,
      login,
      logout,
      getAccessToken: async () => (signedOut ? null : LOCAL_SESSION_TOKEN),
      retry: () => window.location.reload(),
      mock: false,
      wallet: {
        address: LOCAL_SESSION_WALLET,
        ready: true,
        signTypedData: unavailable,
        addPayoutSigner: unavailable,
        removePayoutSigners: unavailable,
      },
    };
  }, [signedOut, login, logout]);

  if (!LOCAL_SESSION_TOKEN) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
