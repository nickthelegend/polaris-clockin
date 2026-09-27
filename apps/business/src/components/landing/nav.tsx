"use client";

import { Button, cn } from "@polaris/ui";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BusinessLogo } from "@/components/app/brand";
import { useOptionalAuth } from "@/lib/auth-context";
import { nav } from "./content";

/**
 * The landing's top bar: the wordmark with the Business chip, section links,
 * and sign-in. A merchant who is already signed in gets "Open dashboard"
 * instead. It turns to glass once the page scrolls.
 */
export function LandingNav() {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300",
        scrolled ? "bg-ui-canvas/75 shadow-[0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Polaris for Business, home" className="shrink-0 rounded-[12px]">
          <BusinessLogo height={30} />
        </Link>

        <nav aria-label="Sections" className="hidden flex-1 justify-center xl:flex">
          <ul className="flex items-center gap-1">
            {nav.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="inline-flex h-10 items-center rounded-full px-3.5 text-[15px] text-ui-muted transition-colors hover:bg-ui-surface-1 hover:text-ui-text"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          {signedIn ? (
            <Button asChild variant="lime" size="md" icon={<LayoutDashboard />}>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="md" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="lime" size="md" iconRight={<ArrowRight />}>
                <Link href="/login">
                  <span className="sm:hidden">Get started</span>
                  <span className="hidden sm:inline">Start accepting payments</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
