"use client";

import { BottomSheet, type SnapPoint } from "@polaris/ui";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { markIntroSeen } from "./first-run";

/**
 * Route sheets. Every screen you *do* (Send, Checkout, Credit…) is a route
 * that renders into the root layout's @sheet slot, through an intercepting
 * route when you open it from inside the app, and over a blurred Home when
 * it is opened cold from a link. The slot's page only renders a marker,
 * <RouteSheet>; the sheet itself lives here, in a host that outlives the
 * route, so it can spring in, and spring out again when the route goes away
 * (a swipe down, the close button, or the browser's Back).
 */

type SheetSpec = {
  snapPoints: SnapPoint[];
  defaultSnap?: SnapPoint;
  title?: ReactNode;
  description?: ReactNode;
  label: string;
  content: ReactNode;
  onClose: () => void;
};

type Entry = SheetSpec & { key: string; open: boolean };

type HostApi = {
  upsert: (key: string, spec: SheetSpec) => void;
  release: (key: string) => void;
};

const HostContext = createContext<HostApi | null>(null);

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SheetHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
    setEntries((list) => list.filter((e) => e.key !== key || e.open));
  }, []);

  const api = useMemo<HostApi>(
    () => ({
      upsert(key, spec) {
        const timer = timers.current.get(key);
        if (timer) clearTimeout(timer);
        timers.current.delete(key);
        setEntries((list) => {
          const i = list.findIndex((e) => e.key === key);
          if (i < 0) return [...list, { ...spec, key, open: true }];
          const next = list.slice();
          next[i] = { ...spec, key, open: true };
          return next;
        });
      },
      release(key) {
        setEntries((list) =>
          list.some((e) => e.key === key && e.open) ? list.map((e) => (e.key === key ? { ...e, open: false } : e)) : list,
        );
        // If the exit animation never reports back (closed before it measured), drop it anyway.
        if (!timers.current.has(key)) timers.current.set(key, setTimeout(() => remove(key), 1400));
      },
    }),
    [remove],
  );

  return (
    <HostContext.Provider value={api}>
      {children}
      {entries.map((e) => (
        <BottomSheet
          key={e.key}
          open={e.open}
          onOpenChange={(next) => {
            if (next) return;
            // Start the exit now; the route follows (Back, or the cold fallback).
            api.release(e.key);
            e.onClose();
          }}
          onClosed={() => remove(e.key)}
          snapPoints={e.snapPoints}
          defaultSnap={e.defaultSnap}
          title={e.title}
          description={e.description}
          aria-label={e.label}
          maxWidth={440}
        >
          {e.content}
        </BottomSheet>
      ))}
    </HostContext.Provider>
  );
}

export type RouteSheetProps = {
  /** Screen readers' name for the sheet (and its visible title, with `title`). */
  label: string;
  title?: ReactNode;
  description?: ReactNode;
  snapPoints?: SnapPoint[];
  defaultSnap?: SnapPoint;
  /**
   * Opened cold (a link from outside): closing replaces the URL with
   * `fallback` instead of going back, since there is nothing to go back to.
   */
  cold?: boolean;
  /** Where a cold sheet lands when it closes. */
  fallback?: string;
  /**
   * Replaces the cold fallback: somewhere better to send someone who came
   * from outside (the merchant's window or page that sent them).
   */
  onColdClose?: () => void;
  children: ReactNode;
};

/** Close the route sheet you are in: Back when it was opened in the app, else to its fallback. */
const CloseContext = createContext<(() => void) | null>(null);

export function useCloseSheet(): () => void {
  const close = useContext(CloseContext);
  const router = useRouter();
  return close ?? (() => router.push("/"));
}

/**
 * Put this in a sheet route's page. It renders nothing where it stands;
 * the host shows the sheet while this is mounted.
 */
export function RouteSheet({
  label,
  title,
  description,
  snapPoints = ["half"],
  defaultSnap,
  cold = false,
  fallback = "/",
  onColdClose,
  children,
}: RouteSheetProps) {
  const host = useContext(HostContext);
  const router = useRouter();
  const key = useId();
  const closing = useRef(false);
  // A cold sheet stays mounted in the page behind it, so it steps aside while
  // another sheet has the URL, and comes back if Back returns to it.
  const pathname = usePathname();
  const [home] = useState(pathname);
  const active = pathname === home;

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    host?.release(key);
    if (!cold) {
      router.back();
      return;
    }
    // Someone who came from a link and backs out has seen enough of Polaris
    // not to be sent through the intro: they land where the fallback says.
    markIntroSeen();
    if (onColdClose) onColdClose();
    else router.replace(fallback, { scroll: false });
  }, [cold, fallback, onColdClose, router, host, key]);

  const content = <CloseContext.Provider value={close}>{children}</CloseContext.Provider>;

  useIsoLayoutEffect(() => {
    // Once closing, stay closed until the route goes away.
    if (!active) host?.release(key);
    else if (!closing.current) host?.upsert(key, { snapPoints, defaultSnap, title, description, label, content, onClose: close });
  });

  useEffect(() => {
    closing.current = false;
    return () => host?.release(key);
  }, [host, key]);

  return null;
}
