"use client";

import { PrimaryButton, TopNav } from "@polaris/ui";
import { ArrowRight, CalendarClock, CircleHelp, CodeXml, Landmark, LayoutDashboard, Link2, LogIn, Tag } from "lucide-react";
import Link from "next/link";

import { BusinessLogo } from "@/components/app/brand";
import { useOptionalAuth } from "@/lib/auth-context";
import { nav } from "./content";

const ICONS: Record<string, React.ReactNode> = {
  "#ways": <Link2 />,
  "#credit": <CalendarClock />,
  "#developers": <CodeXml />,
  "#payouts": <Landmark />,
  "#pricing": <Tag />,
  "#faq": <CircleHelp />,
};

/** A dark pill in the wallet pill's shape: where Polaris runs today. */
export function NetworkPill({ className }: { className?: string }) {
  return (
    <span className={`inline-flex h-11 items-center gap-2.5 rounded-full bg-ui-surface-1 pr-5 pl-4 text-[15px] font-medium whitespace-nowrap ${className ?? ""}`}>
      <span aria-hidden className="relative grid size-2.5 place-items-center">
        <span className="absolute size-2.5 animate-ping rounded-full bg-ui-lime-button/60 motion-reduce:animate-none" />
        <span className="size-2 rounded-full bg-ui-lime-button" />
      </span>
      Live on Monad testnet
    </span>
  );
}

/**
 * The landing's top bar, ref E's TopNav: the wordmark, the section links,
 * where Polaris runs, and the lime "Sign in" pill (or "Open dashboard" for a
 * merchant who is already signed in). Phones get the compact bar and a sheet.
 */
export function LandingNav() {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const cta = signedIn ? (
    <PrimaryButton asChild size="sm" iconRight={<LayoutDashboard />}>
      <Link href="/dashboard">Open dashboard</Link>
    </PrimaryButton>
  ) : (
    <PrimaryButton asChild size="sm" iconRight={<LogIn />}>
      <Link href="/login">Sign in</Link>
    </PrimaryButton>
  );
  return (
    <TopNav
      brand={<BusinessLogo height={30} />}
      brandHref="/"
      brandLabel="Polaris for Business, home"
      items={nav.links.map((l) => ({ key: l.href, label: l.label, href: l.href, icon: ICONS[l.href] }))}
      linkAs="a"
      sheetTitle="Polaris for Business"
      actions={
        <>
          <NetworkPill className="hidden xl:inline-flex" />
          {cta}
        </>
      }
      compactActions={cta}
      sheetFooter={
        <PrimaryButton asChild size="lg" block iconRight={<ArrowRight />}>
          <Link href={signedIn ? "/dashboard" : "/login"}>{signedIn ? "Open dashboard" : "Start accepting payments"}</Link>
        </PrimaryButton>
      }
    />
  );
}
