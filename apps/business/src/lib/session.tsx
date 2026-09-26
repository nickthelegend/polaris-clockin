"use client";

import { getAccessToken, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import { createHttpData, DataError, type DashboardData } from "./data";

/**
 * The dashboard's data source, bound to the signed-in merchant's Privy access
 * token. Privy's standalone `getAccessToken` refreshes the token as needed and
 * works outside React, so one source serves every component.
 */
const source = createHttpData(() => getAccessToken());

export function useDashboardData(): DashboardData {
  return source;
}

/** The merchant's embedded (Privy) wallet, once Privy has created it. */
export function useEmbeddedWallet() {
  const { wallets, ready } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? null;
  return { wallet, ready };
}

type QueryState<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  mutate: (update: (current: T | undefined) => T | undefined) => void;
};

/**
 * Load something from the data source, with loading, error and reload. Small
 * on purpose: the dashboard has one reader per page and no cross-page cache.
 */
export function useQuery<T>(load: (data: DashboardData) => Promise<T>, options: { refreshMs?: number } = {}): QueryState<T> {
  const source = useDashboardData();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current(source)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof DataError || err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, nonce]);

  useEffect(() => {
    if (!options.refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, options.refreshMs);
    return () => clearInterval(id);
  }, [options.refreshMs]);

  const reload = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);
  const mutate = useCallback((update: (current: T | undefined) => T | undefined) => setData(update), []);

  return { data, error, loading: loading && data === undefined, reload, mutate };
}
