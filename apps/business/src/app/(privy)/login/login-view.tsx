"use client";

import {
  Avatar,
  BarChart,
  Button,
  Card,
  ErrorState,
  Input,
  Money,
  Skeleton,
  StatCard,
  TxRow,
} from "@polaris/ui";
import { ArrowLeft, ArrowRight, LockKeyhole, Percent, Store } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BusinessLogo } from "@/components/app/brand";
import { Glass } from "@/components/app/glass";
import { SetupScreen } from "@/components/app/setup-screen";
import { BlurWords, Rise } from "@/components/motion";
import { useAuth } from "@/lib/auth-context";
import { DataError, errorMessage } from "@/lib/data";
import { safeNext } from "@/lib/next-path";
import { useDashboardData, useQuery } from "@/lib/session";

export function LoginView() {
  const auth = useAuth();
  const next = safeNext(useSearchParams().get("next"));

  if (auth.status === "unconfigured") return <SetupScreen />;

  return (
    <LoginFrame>
      {auth.status === "unreachable" ? (
        <div className="-mx-6">
          <ErrorState
            title="We couldn't reach our sign-in service"
            description="Check your connection, or turn off ad and tracker blockers for this site, then try again."
            onRetry={auth.retry}
            className="items-start px-6 text-left"
          />
        </div>
      ) : auth.status === "signed-in" ? (
        <Onboarding next={next} />
      ) : (
        <SignIn loading={auth.status === "loading"} onContinue={auth.login} />
      )}
    </LoginFrame>
  );
}

/** The page: the form on the left, a live visual on wide screens. */
export function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate grid min-h-dvh overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div aria-hidden className="glow-lime absolute -top-56 -left-40 -z-10 h-[620px] w-[620px]" />
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16 lg:py-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Polaris for Business, home" className="rounded-[12px]">
            <BusinessLogo height={32} />
          </Link>
          <Button asChild variant="ghost" size="sm" icon={<ArrowLeft />}>
            <Link href="/">Home</Link>
          </Button>
        </div>
        <div className="flex flex-1 flex-col justify-center py-10 lg:py-12">
          {/* Phones and tablets: the glass renders above the form (the wide visual is lg+). */}
          <div aria-hidden className="relative mb-8 h-[132px] w-full max-w-[440px] lg:hidden">
            <Glass art="card-lime" size={200} priority className="float-slow absolute top-0 left-[18%] w-[168px] rotate-[-12deg]" />
            <Glass art="coin-purple" size={96} className="float-slower absolute top-[46px] left-0 w-[72px]" />
            <Glass art="coin-crimson" size={72} className="float-slow absolute top-[8px] right-[6%] w-[54px] opacity-90" />
          </div>
          <div className="w-full max-w-[440px]">{children}</div>
        </div>
        <p className="text-[13px] text-ui-muted">Test mode on Monad testnet. No real money moves.</p>
      </div>
      <Showcase />
    </main>
  );
}

/* ── Signed out: one Continue, Privy's modal does the rest ──────────────── */

function SignIn({ loading, onContinue }: { loading: boolean; onContinue: () => void }) {
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <BlurWords
          as="h1"
          css
          text={["Get paid in full,", "in under a second."]}
          lineClassName="block"
          className="text-[clamp(38px,4.2vw,56px)] leading-[1.02] font-medium tracking-[-0.045em]"
        />
        <Rise y={10} delay={0.25} duration={0.7}>
          <p className="text-[17px] leading-[1.5] text-ui-muted">
            Sign in to share payment links, follow every Pay in 4 plan and move your money. New here? The same step creates
            your account and your payout account.
          </p>
        </Rise>
      </div>

      <Rise y={10} delay={0.35} duration={0.7} className="grid gap-4">
        <Button variant="lime" size="xl" block onClick={onContinue} loading={loading} iconRight={<ArrowRight />}>
          Continue
        </Button>
        {loading ? (
          <p role="status" className="text-center text-[14px] text-ui-muted">
            Starting secure sign-in…
          </p>
        ) : null}
        <p className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ui-muted">
          <LockKeyhole aria-hidden size={16} strokeWidth={1.75} className="mt-[3px] shrink-0 text-ui-lime" />
          <span>
            Sign-in is by Privy, with the methods shown in the next step. Your payout account is yours alone: we can&rsquo;t move
            money out of it.
          </span>
        </p>
      </Rise>
    </div>
  );
}

/* ── Signed in: name the business once, then in ─────────────────────────── */

function Onboarding({ next }: { next: string }) {
  const router = useRouter();
  const data = useDashboardData();
  const { logout } = useAuth();
  const { data: merchant, error, loading, reload } = useQuery((d) => d.getMerchant());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const named = Boolean(merchant?.businessName);
  useEffect(() => {
    if (named) router.replace(next);
  }, [named, next, router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const value = name.trim();
    if (value.length < 2) {
      setFormError("Enter your business name as buyers should see it: at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      await data.updateMerchant({ businessName: value });
      router.replace(next);
    } catch (err) {
      setFormError(err instanceof DataError ? err.message : errorMessage(err, "We couldn't save that. Try again."));
      setBusy(false);
    }
  }

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  if (error && !merchant) {
    return (
      <div className="-mx-6">
        <ErrorState
          title="We couldn't open your account"
          description={error}
          onRetry={reload}
          action={
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
          className="items-start px-6 text-left"
        />
      </div>
    );
  }

  if (loading || !merchant || named) {
    return (
      <div className="grid gap-5" aria-busy="true" aria-label="Opening your dashboard">
        <Skeleton width="80%" height={44} />
        <Skeleton width="100%" height={20} />
        <Skeleton shape="pill" width="100%" height={64} />
        <p role="status" className="text-[14px] text-ui-muted">
          Opening your dashboard…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} noValidate className="grid gap-7">
      <div className="grid gap-4">
        <h1 className="text-[clamp(34px,4.4vw,48px)] leading-[1.04] font-medium tracking-[-0.04em]">
          What&rsquo;s your business called?
        </h1>
        <p className="text-[17px] leading-[1.5] text-ui-muted">
          Buyers see it on every link, checkout and receipt. That&rsquo;s the whole setup: your payout account is already
          being created.
        </p>
      </div>
      <Input
        label="Business name"
        icon={<Store />}
        autoComplete="organization"
        placeholder="Oat & Ember"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={formError ?? undefined}
        size="lg"
        autoFocus
      />
      <div className="grid gap-3">
        <Button type="submit" variant="lime" size="xl" block loading={busy} iconRight={<ArrowRight />}>
          Open the dashboard
        </Button>
        <Button variant="ghost" size="md" onClick={() => void signOut()}>
          Use another account
        </Button>
      </div>
    </form>
  );
}

/* ── The visual: a glass card and a mini dashboard, from real components ── */

const WEEK = [
  { label: "Mon", value: 12 },
  { label: "Tue", value: 26 },
  { label: "Wed", value: 38 },
  { label: "Thu", value: 24 },
  { label: "Fri", value: 9 },
  { label: "Sat", value: 27 },
  { label: "Sun", value: 22 },
];

function Showcase() {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden p-3 lg:block">
      <div className="relative h-full overflow-hidden rounded-[40px] bg-ui-surface-1">
        <div className="grid-ground absolute inset-0" />
        <div className="glow-violet absolute -right-40 -bottom-40 h-[560px] w-[560px]" />
        <Glass art="card-lime" size={360} priority className="float-slow absolute top-[6%] right-[8%] w-[300px] rotate-[-10deg] xl:w-[360px]" />
        <Glass art="coin-purple" size={130} className="float-slower absolute bottom-[10%] left-[6%] w-[110px]" />
        <Glass art="coin-crimson" size={80} className="float-slow absolute top-[12%] left-[12%] w-[70px] opacity-90" />

        <div className="absolute inset-x-[10%] bottom-[12%] grid gap-3 xl:inset-x-[14%]">
          <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
            <StatCard
              tone="sage"
              icon={<Percent />}
              label="Sales"
              delta={23}
              value={<Money value={24575} decimals={0} spaced dim="none" />}
              spark={[18, 21, 19.5, 20, 22.6, 17.8, 18.4, 21.2, 23.1, 17.6, 20.8, 22.2, 19.4, 18.3, 23.6]}
            />
            <Card padding="md" className="hidden bg-ui-canvas/80 backdrop-blur xl:block">
              <p className="text-[15px] font-medium">Customers this week</p>
              <BarChart label="Customers this week" data={WEEK} height={96} showAxis={false} className="mt-3" />
            </Card>
          </div>
          <Card padding="sm" className="grid gap-2 bg-ui-canvas/80 backdrop-blur">
            <TxRow static variant="card" leading={<Avatar name="Ana Ruiz" size="md" />} title="Ana Ruiz" subtitle="Pay in 4 · 1 minute ago" amount={200} />
            <TxRow static variant="card" leading={<Avatar name="Kofi Mensah" size="md" />} title="Kofi Mensah" subtitle="Pay now · 3 minutes ago" amount={52} />
          </Card>
        </div>
      </div>
    </aside>
  );
}
