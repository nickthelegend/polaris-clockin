"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { DEV_MOCK_SESSION } from "@/lib/auth-context";
import { PRIVY_CONFIGURED, PrivyAuthProvider, UnconfiguredAuthProvider } from "./privy-auth";

/**
 * The development-only mock session. NODE_ENV is replaced at build time, so in
 * a production build this is `null` and the mock module is never compiled into
 * any bundle (no import reaches it).
 */
const MockAuthProvider =
  process.env.NODE_ENV === "development" ? dynamic(() => import("./mock-auth").then((m) => m.MockAuthProvider)) : null;

/**
 * Sign-in for the landing, /login and the dashboard (the (privy) route
 * group). Not mounted on /gallery or the 404 page, which need no session.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Development only; `false` in every production build (see auth-context).
  if (process.env.NODE_ENV === "development" && DEV_MOCK_SESSION && MockAuthProvider) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }
  if (!PRIVY_CONFIGURED) return <UnconfiguredAuthProvider>{children}</UnconfiguredAuthProvider>;
  return <PrivyAuthProvider>{children}</PrivyAuthProvider>;
}
