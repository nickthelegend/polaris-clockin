"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type AccountState, getServerSnapshot, getSnapshot, subscribe } from "./index";
import { type AccountSupport, checkAccountSupport, isInAppBrowser } from "./support";

/** The account's state, kept in sync across the app (and other tabs). */
export function useAccountState(): AccountState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type SupportState = { status: "checking" } | ({ status: "done" } & AccountSupport);

/** Whether this browser can hold an account. Reads only; never starts a ceremony. */
export function useAccountSupport(): SupportState {
  const [state, setState] = useState<SupportState>({ status: "checking" });
  useEffect(() => {
    let live = true;
    void checkAccountSupport().then((result) => {
      if (live) setState({ status: "done", ...result });
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
