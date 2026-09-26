"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type AccountState, getServerSnapshot, getSnapshot, subscribe } from "./index";
import { type AccountSupport, checkAccountSupport, isInAppBrowser } from "./support";

/** The account's state, kept in sync across the app (and other tabs). */
export function useAccountState(): AccountState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type SupportState = { status: "checking" } | ({ status: "done" } & AccountSupport);

// Checked once per page load; every later mount (a sheet, the next screen) gets the answer at once.
let supportResult: SupportState | null = null;
let supportPending: Promise<SupportState> | null = null;

function loadSupport(): Promise<SupportState> {
  supportPending ??= checkAccountSupport().then((result) => {
    supportResult = { status: "done", ...result };
    return supportResult;
  });
  return supportPending;
}

/** Whether this browser can hold an account. Reads only; never starts a ceremony. */
export function useAccountSupport(): SupportState {
  const [state, setState] = useState<SupportState>(() => supportResult ?? { status: "checking" });
  useEffect(() => {
    if (supportResult) return;
    let live = true;
    void loadSupport().then((result) => {
      if (live) setState(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** True inside an Instagram/Facebook/TikTok-style WebView. */
export function useInAppBrowser(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => isInAppBrowser(navigator.userAgent),
    () => false,
  );
}
