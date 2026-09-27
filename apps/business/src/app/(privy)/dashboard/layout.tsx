"use client";

import { Button, ErrorState, Skeleton } from "@polaris/ui";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { SetupScreen } from "@/components/app/setup-screen";
import { BusinessLogo } from "@/components/app/brand";
import { DashboardShell } from "@/components/shell/dashboard-shell";
import { useAuth } from "@/lib/auth-context";
import { MerchantContext } from "@/lib/merchant-context";
import { SampleProvider, useQuery } from "@/lib/session";
import { consumeExplicitSignOut, markExplicitSignOut } from "@/lib/sign-out";

/**
 * Every dashboard page sits behind this gate: Privy must be ready and signed
 * in, and the merchant must have named their business (the one onboarding
 * step, on /login). A visitor who isn't signed in goes to /login and comes
 * back here after; someone who just pressed Sign out goes to /login plain.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/dashboard";

  useEffect(() => {
    if (auth.status !== "signed-out") return;
    router.replace(consumeExplicitSignOut() ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.status, router, pathname]);

  if (auth.status === "unconfigured") return <SetupScreen />;
  if (auth.status === "unreachable") {
    return (
      <FullPage>
        <ErrorState
          title="We couldn't reach our sign-in service"
          description="Check your connection, or turn off ad and tracker blockers for this site, then try again."
          onRetry={auth.retry}
        />
      </FullPage>
    );
  }
  if (auth.status !== "signed-in") return <FrameSkeleton />;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/dashboard";
  const { logout, wallet } = useAuth();
  const { data: merchant, error, reload } = useQuery((d) => d.getMerchant());
  // What the server is connected to (chain, relayer, payout signer). Public and
  // secret-free; the money controls read it to say why they're off.
  const { data: capabilities } = useQuery((d) => d.getCapabilities());

  const needsName = merchant !== undefined && !merchant.businessName;
  useEffect(() => {
    if (needsName) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [needsName, router, pathname]);

  // The payout wallet is created right after the first sign-in. Until the
  // server sees it, look again every few seconds, and at once when Privy
  // reports it in this browser.
  const walletPending = merchant !== undefined && !merchant.walletAddress;
  useEffect(() => {
    if (!walletPending) return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [walletPending, reload]);
  useEffect(() => {
    if (walletPending && wallet.address) reload();
  }, [walletPending, wallet.address, reload]);

  const value = useMemo(
    () => (merchant ? { merchant, refresh: reload, capabilities: capabilities ?? null } : null),
    [merchant, reload, capabilities],
  );

  if (error && !merchant) {
    return (
      <FullPage>
        <ErrorState
          title="We couldn't open your dashboard"
          description={error}
          onRetry={reload}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                markExplicitSignOut();
                await logout();
                router.replace("/login");
              }}
            >
              Sign out
            </Button>
          }
        />
      </FullPage>
    );
  }
  if (!value || needsName) return <FrameSkeleton />;

  return (
    <MerchantContext.Provider value={value}>
      <SampleProvider merchant={value.merchant}>
        <DashboardShell merchant={value.merchant}>{children}</DashboardShell>
      </SampleProvider>
    </MerchantContext.Provider>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid w-full max-w-[520px] justify-items-center gap-4">
        <BusinessLogo height={32} />
        {children}
      </div>
    </main>
  );
}

/** The frame, loading: the rail and a few cards, so nothing jumps when it arrives. */
function FrameSkeleton() {
  return (
    <div className="md:flex" aria-busy="true" aria-label="Loading your dashboard">
      <div className="hidden h-dvh w-[88px] shrink-0 p-3 md:block xl:w-[264px]">
        <div className="h-full rounded-ui-card bg-ui-surface-1" />
      </div>
      <div className="min-w-0 flex-1 px-4 pt-6 sm:px-6 xl:px-8">
        <div className="mx-auto w-full max-w-[1320px]">
          <Skeleton width={160} height={16} />
          <Skeleton width={260} height={40} className="mt-3" />
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} shape="card" height={176} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Skeleton shape="card" height={320} />
            <Skeleton shape="card" height={320} />
          </div>
          <p role="status" className="sr-only">
            Loading your dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
