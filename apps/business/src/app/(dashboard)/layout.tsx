"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { Shell } from "@/components/shell";
import { ErrorState, Skeleton } from "@/components/ui";
import { MerchantContext } from "@/lib/merchant-context";
import { useQuery } from "@/lib/session";

/**
 * Every dashboard page sits behind this: Privy must be ready and signed in,
 * and the merchant must have named their business (the one onboarding step).
 * Anything else goes to /login, which handles both.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace(pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, authenticated, router, pathname]);

  if (!ready || !authenticated) return <FrameSkeleton />;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: merchant, error, loading, reload } = useQuery((d) => d.getMerchant());

  const needsName = merchant !== undefined && !merchant.businessName;
  useEffect(() => {
    if (needsName) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [needsName, router, pathname]);

  const value = useMemo(() => (merchant ? { merchant, refresh: reload } : null), [merchant, reload]);

  if (error && !merchant) {
    return (
      <Shell merchant={null}>
        <ErrorState message={error} onRetry={reload} />
      </Shell>
    );
  }
  if (loading || !value || needsName) return <FrameSkeleton />;

  return (
    <MerchantContext.Provider value={value}>
      <Shell merchant={value.merchant}>{children}</Shell>
    </MerchantContext.Provider>
  );
}

function FrameSkeleton() {
  return (
    <div className="lg:flex" aria-busy="true" aria-label="Loading your dashboard">
      <div className="hidden h-dvh w-[252px] shrink-0 p-3 lg:block">
        <div className="h-full rounded-[24px] bg-[var(--rail)] opacity-95" />
      </div>
      <div className="mx-auto w-full max-w-[1240px] px-4 pt-10 sm:px-6 lg:px-10">
        <Skeleton width="180px" height="28px" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="panel h-[240px]" />
          <div className="panel h-[240px]" />
        </div>
      </div>
    </div>
  );
}
