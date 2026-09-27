"use client";

import { Button, EmptyState, ErrorState, Notice, PanelCard, StatusPill, cn, type PanelCardProps } from "@polaris/ui";
import { RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { formatAgo } from "@/lib/data/format";
import { useSample, type QueryState } from "@/lib/session";

/** The chip on every card and row that shows sample data: ref E's amber pill. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <StatusPill tone="amber" size="sm" className={cn("h-6 px-2.5 text-[12px]", className)} title="Sample data, not your real numbers">
      Sample
    </StatusPill>
  );
}

/** A dashboard panel: ref E's outlined card with a title row (title, subtitle, sample chip, action). */
export function Panel({
  title,
  sample,
  ...props
}: Omit<PanelCardProps, "title" | "badge"> & {
  title: ReactNode;
  sample?: boolean;
}) {
  return <PanelCard title={title} badge={sample ? <SampleBadge /> : undefined} {...props} />;
}

/** "See all": a real link with a 40px target. */
export function SeeAll({ href, children = "See all" }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="-my-2 -mr-3 inline-flex h-10 items-center rounded-full px-3 text-[15px] text-ui-muted transition-colors hover:bg-ui-surface-1 hover:text-ui-lime-active"
    >
      {children}
    </Link>
  );
}

/** A clock for "2 min ago" labels. Deliberately not in a live region, so it isn't re-announced. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * When a refresh fails while older data is on screen: say so, say when the
 * data is from, and offer a retry, instead of silently showing old numbers.
 */
export function StaleNotice({ queries }: { queries: QueryState<unknown>[] }) {
  const now = useNow(15_000);
  const stale = queries.find((q) => q.stale);
  if (!stale) return null;
  return (
    <Notice
      tone="warn"
      role="alert"
      className="mb-5"
      title={stale.updatedAt ? `Showing data from ${formatAgo(new Date(stale.updatedAt).toISOString(), now)}` : "Showing older data"}
      action={
        <Button variant="outline" size="sm" icon={<RotateCcw />} onClick={() => queries.forEach((q) => q.stale && q.reload())}>
          Retry
        </Button>
      }
    >
      The last refresh failed: {stale.error}
    </Notice>
  );
}

/** A failed first load inside a panel. */
export function LoadError({ query, title = "We couldn't load this" }: { query: QueryState<unknown>; title?: string }) {
  return <ErrorState size="sm" title={title} description={query.error ?? undefined} onRetry={query.reload} />;
}

/**
 * The note at the top of the money pages: sample data is on (and how to turn
 * it off), or nothing has settled yet (and how to preview).
 */
export function DataModeNotice({ empty, className }: { empty: boolean; className?: string }) {
  const sample = useSample();
  if (sample.reason === "preview") {
    return (
      <Notice
        tone="warn"
        className={cn("mb-5", className)}
        icon={<Sparkles />}
        title="You're previewing sample data"
        action={
          <Button variant="outline" size="sm" onClick={() => sample.setPreview(false)}>
            Show my data
          </Button>
        }
      >
        Every card and row marked Sample is invented. Your links, keys and webhooks are still your own.
      </Notice>
    );
  }
  // Development only: compiled out of production builds. A small pill in the
  // corner, so the pages keep their layout in screenshots; every card still
  // carries its Sample chip.
  if (process.env.NODE_ENV === "development" && sample.reason === "mock") return <MockNote />;
  if (sample.reason === "server") {
    return (
      <Notice tone="warn" className={cn("mb-5", className)} icon={<Sparkles />} title="This server shows demo data">
        Payments, plans and payouts marked Sample are invented. They stay labelled until this server is connected to Monad.
      </Notice>
    );
  }
  if (!empty) return null;
  return (
    <Notice
      tone="lime"
      className={cn("mb-5", className)}
      title="Your dashboard fills in as payments settle"
      action={
        <>
          <Button variant="outline" size="sm" icon={<Sparkles />} onClick={() => sample.setPreview(true)}>
            Preview with sample data
          </Button>
          <Button asChild variant="lime" size="sm">
            <Link href="/dashboard/links?new=1">New payment link</Link>
          </Button>
        </>
      }
    >
      Share a link and the first payment shows here within a second of the buyer confirming.
    </Notice>
  );
}

/**
 * Development only: "Dev mock session" for a few seconds, then a small amber
 * dot that says it on hover. Never in captures: not for an automated browser
 * (`navigator.webdriver`) or with `?capture=1`.
 */
function MockNote() {
  const [folded, setFolded] = useState(false);
  const capturing = useSyncExternalStore(
    () => () => undefined,
    () => navigator.webdriver || new URLSearchParams(window.location.search).has("capture"),
    () => true,
  );
  useEffect(() => {
    const t = setTimeout(() => setFolded(true), 4000);
    return () => clearTimeout(t);
  }, []);
  if (capturing) return null;
  return (
    <p
      role="note"
      title="Development mock session: sample data in the browser, for screenshots. Nothing here talks to the API."
      className="group fixed bottom-3 left-3 z-40 flex h-7 items-center gap-1.5 overflow-hidden rounded-full bg-ui-pill-amber/90 px-2 text-[12px] font-medium whitespace-nowrap text-ui-pill-amber-text backdrop-blur"
    >
      <Sparkles aria-hidden size={13} strokeWidth={1.75} className="shrink-0" />
      <span className={folded ? "sr-only group-hover:not-sr-only" : "pr-1"}>Dev mock session</span>
    </p>
  );
}

/** The inside of a panel with nothing to show yet. */
export function PanelEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <EmptyState size="sm" icon={icon} title={title} description={description} action={action} className="flex-1 justify-center" />;
}
