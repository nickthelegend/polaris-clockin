"use client";

import { Badge, Button, Card, EmptyState, ErrorState, Notice, cn, type CardProps } from "@polaris/ui";
import { RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { formatAgo } from "@/lib/data/format";
import { useSample, type QueryState } from "@/lib/session";

/** The chip on every card and row that shows sample data. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warn" size="sm" className={cn("shrink-0", className)} title="Sample data, not your real numbers">
      Sample
    </Badge>
  );
}

/** A dashboard panel: the library Card with a title row (title, subtitle, sample chip, action). */
export function Panel({
  title,
  subtitle,
  action,
  sample,
  children,
  className,
  padding = "lg",
  headingLevel: H = "h2",
  ...props
}: Omit<CardProps, "title"> & {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  sample?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <Card padding={padding} className={cn("flex min-w-0 flex-col", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <H className="truncate text-[20px] leading-tight font-medium tracking-[-0.02em] text-ui-text">{title}</H>
            {sample ? <SampleBadge /> : null}
          </div>
          {/* Beside the action from 640px; below it, full width, on phones. */}
          {subtitle ? <p className="mt-1 hidden text-[14px] text-ui-muted sm:block">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {subtitle ? <p className="mt-1.5 text-[14px] text-ui-muted sm:hidden">{subtitle}</p> : null}
      {children}
    </Card>
  );
}

/** "See all": a real link with a 40px target. */
export function SeeAll({ href, children = "See all" }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="-my-2 -mr-3 inline-flex h-10 items-center rounded-full px-3 text-[15px] text-ui-muted transition-colors hover:bg-ui-surface-2 hover:text-ui-text"
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
  // Development only: compiled out of production builds.
  if (process.env.NODE_ENV === "development" && sample.reason === "mock") {
    return (
      <Notice tone="warn" className={cn("mb-5", className)} icon={<Sparkles />} title="Development mock session">
        Sample data in the browser, for screenshots. Nothing here talks to the API.
      </Notice>
    );
  }
  if (sample.reason === "server") {
    return (
      <Notice tone="warn" className={cn("mb-5", className)} icon={<Sparkles />} title="This server shows demo data">
        Payments, plans and payouts marked Sample are invented, and they reset when the server restarts.
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

/** The inside of a panel with nothing to show yet. */
export function PanelEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <EmptyState size="sm" icon={icon} title={title} description={description} action={action} className="flex-1 justify-center" />;
}
