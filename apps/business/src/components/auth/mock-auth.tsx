"use client";

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { AuthContext, DEV_MOCK_SESSION, type AuthState } from "@/lib/auth-context";
import { SAMPLE_MERCHANT } from "@/lib/data/sample";

const SIGNED_OUT_KEY = "polaris:dev-mock-signed-out";
const listeners = new Set<() => void>();

function readSignedOut(): boolean {
  try {
    return window.sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    // No storage: stay signed in.
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
 * DEVELOPMENT ONLY: a fake signed-in session for screenshots of the
 * dashboard, with every read and write served from sample data in the
 * browser. It never talks to our API, so there is no server-side bypass to
 * leave behind. It renders only when `next dev` runs with
 * POLARIS_DEV_MOCK_SESSION=1; in a production build `DEV_MOCK_SESSION` is the
 * literal `false` and the provider that would mount this is removed.
 */
export function MockAuthProvider({ children }: { children: ReactNode }) {
  // `null` on the server and while hydrating: "loading", as Privy would be.
  const signedOut = useSyncExternalStore<boolean | null>(subscribe, readSignedOut, () => null);

  const login = useCallback(() => writeSignedOut(false), []);
  const logout = useCallback(async () => writeSignedOut(true), []);

  const value = useMemo<AuthState>(() => {
    // No wallet and no API: a "signature" is a placeholder that only the
    // in-browser sample data source ever sees, so flows can be captured.
    const fakeSign = async () => {
      await new Promise((r) => setTimeout(r, 500));
      return `0x${"00".repeat(65)}` as const;
    };
    return {
      status: signedOut === null ? "loading" : signedOut ? "signed-out" : "signed-in",
      user: signedOut === false ? { id: SAMPLE_MERCHANT.id, email: SAMPLE_MERCHANT.email } : null,
      login,
      logout,
      getAccessToken: async () => null,
      retry: () => window.location.reload(),
      mock: true,
      wallet: {
        address: SAMPLE_MERCHANT.walletAddress,
        ready: true,
        signTypedData: fakeSign,
        addPayoutSigner: async () => undefined,
        removePayoutSigners: async () => undefined,
      },
    };
  }, [signedOut, login, logout]);

  if (!DEV_MOCK_SESSION) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
