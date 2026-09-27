"use client";

import { toast } from "@polaris/ui";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { DEV_MOCK_SAMPLE, useAuth } from "./auth-context";
import { createHttpData, errorMessage, type DashboardData } from "./data";
import { createSampleData, withSampleMoney } from "./data/sample";
import type { Merchant } from "./data/types";
import { readiness, type Readiness, type SampleReason } from "./features";
import { MerchantContext } from "./merchant-context";

/* ── The live data source, bound to the session ─────────────────────────── */

const LiveDataContext = createContext<DashboardData | null>(null);

/**
 * A 401 can arrive from any request; the provider below listens for it. Kept
 * outside React so the data source never closes over component state.
 */
const sessionEndedListeners = new Set<() => void>();
const announceSessionEnded = () => sessionEndedListeners.forEach((l) => l());
let ending = false;

/**
 * The dashboard's data source for the signed-in merchant. A 401 from the API
 * (the session ended or the token is no longer valid) signs out, says so in a
 * toast, and goes to /login, back to this page afterwards.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { mock, getAccessToken, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const source = useMemo<DashboardData>(
    () =>
      mock
        ? createSampleData(undefined, { empty: !DEV_MOCK_SAMPLE })
        : createHttpData(getAccessToken, { onSessionEnded: announceSessionEnded }),
    [mock, getAccessToken],
  );

  useEffect(() => {
    const onEnded = () => {
      if (ending) return;
      ending = true;
      toast({ id: "session-ended", title: "Your session ended. Sign in again.", tone: "info", duration: 6000 });
      void logout()
        .catch(() => undefined)
        .finally(() => {
          router.replace(pathname && pathname !== "/login" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
          setTimeout(() => (ending = false), 2000);
        });
    };
    sessionEndedListeners.add(onEnded);
    return () => {
      sessionEndedListeners.delete(onEnded);
    };
  }, [logout, router, pathname]);

  return <LiveDataContext.Provider value={source}>{children}</LiveDataContext.Provider>;
}

/* ── Sample data: the per-viewer preview, the server demo book, the mock ── */

const PREVIEW_KEY = "polaris:sample-preview";
const previewListeners = new Set<() => void>();

function readPreview(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

function writePreview(on: boolean) {
  try {
    if (on) window.localStorage.setItem(PREVIEW_KEY, "1");
    else window.localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Storage blocked: the preview simply won't be remembered.
  }
  previewListeners.forEach((l) => l());
}

export type SampleState = {
  /** Sample data is on screen: label every card and row that shows it. */
  on: boolean;
  /** Why: the dev mock session, a server with no chain (its sample book), or the viewer's preview. */
  reason: SampleReason;
  /** Only the viewer's own preview can be switched off. */
  canToggle: boolean;
  setPreview: (on: boolean) => void;
};

type ScopedData = { data: DashboardData; sample: SampleState };
const ScopedDataContext = createContext<ScopedData | null>(null);

/**
 * Inside the dashboard: which source the money views read (live, or sample
 * with the merchant's own links, keys and webhooks), and whether to label it.
 */
export function SampleProvider({ merchant, children }: { merchant: Merchant; children: ReactNode }) {
  const live = useLiveData();
  const { mock } = useAuth();
  const preview = useSyncExternalStore(
    (l) => {
      previewListeners.add(l);
      return () => previewListeners.delete(l);
    },
    readPreview,
    () => false,
  );

  const reason: SampleState["reason"] =
    mock && DEV_MOCK_SAMPLE ? "mock" : merchant.sample ? "server" : preview ? "preview" : null;
  const data = useMemo(
    () => (reason === "preview" ? withSampleMoney(live, merchant) : live),
    // The merchant's id is enough: the sample book is seeded from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reason, live, merchant.id],
  );
  const value = useMemo<ScopedData>(
    () => ({ data, sample: { on: reason !== null, reason, canToggle: reason === null || reason === "preview", setPreview: writePreview } }),
    [data, reason],
  );
  return <ScopedDataContext.Provider value={value}>{children}</ScopedDataContext.Provider>;
}

export function useLiveData(): DashboardData {
  const ctx = useContext(LiveDataContext);
  if (!ctx) throw new Error("useLiveData must be used inside the DataProvider.");
  return ctx;
}

/** The source a page reads: sample money views when sample data is on. */
export function useDashboardData(): DashboardData {
  const scoped = useContext(ScopedDataContext);
  const live = useContext(LiveDataContext);
  const source = scoped?.data ?? live;
  if (!source) throw new Error("useDashboardData must be used inside the DataProvider.");
  return source;
}

export function useSample(): SampleState {
  return (
    useContext(ScopedDataContext)?.sample ?? { on: false, reason: null, canToggle: false, setPreview: writePreview }
  );
}

/* ── useQuery ───────────────────────────────────────────────────────────── */

export type QueryState<T> = {
  data: T | undefined;
  /** The last load's error, even when older data is still on screen. */
  error: string | null;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** A reload is in flight with data on screen. */
  refreshing: boolean;
  /** Data is on screen, but the latest refresh failed: show it inline. */
  stale: boolean;
  /** When the data on screen was loaded. */
  updatedAt: number | null;
  reload: () => void;
  mutate: (update: (current: T | undefined) => T | undefined) => void;
};

/**
 * Load something from the page's data source, with loading, error, reload
 * and an optional refresh interval (only while the tab is visible). A failed
 * refresh keeps the older data and reports `stale`, so the page can say so
 * instead of silently showing old numbers.
 */
export function useQuery<T>(load: (data: DashboardData) => Promise<T>, options: { refreshMs?: number } = {}): QueryState<T> {
  const source = useDashboardData();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  // A different source (sample data switched on or off): start over.
  const [seenSource, setSeenSource] = useState(source);
  if (seenSource !== source) {
    setSeenSource(source);
    setData(undefined);
    setError(null);
    setInFlight(true);
  }

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current(source)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        setUpdatedAt(Date.now());
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setInFlight(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, nonce]);

  useEffect(() => {
    if (!options.refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        setInFlight(true);
        setNonce((n) => n + 1);
      }
    }, options.refreshMs);
    return () => clearInterval(id);
  }, [options.refreshMs]);

  const reload = useCallback(() => {
    setInFlight(true);
    setNonce((n) => n + 1);
  }, []);
  const mutate = useCallback((update: (current: T | undefined) => T | undefined) => setData(update), []);

  return {
    data,
    error,
    loading: inFlight && data === undefined && !error,
    refreshing: inFlight && data !== undefined,
    stale: Boolean(error) && data !== undefined,
    updatedAt,
    reload,
    mutate,
  };
}

/**
 * Whether withdraw, automatic payouts, links and registration can work now,
 * from what the server is connected to and whether sample data is on. Each
 * value is null when ready, otherwise the reason to show beside the control.
 */
export function useReadiness(): Readiness {
  const capabilities = useContext(MerchantContext)?.capabilities;
  const { reason } = useSample();
  return useMemo(() => readiness(capabilities, reason), [capabilities, reason]);
}
