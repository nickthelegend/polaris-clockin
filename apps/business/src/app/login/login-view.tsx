"use client";

import { useLogin, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand";
import { Button, Field, InlineMessage, Skeleton, TextInput } from "@/components/ui";
import { DataError } from "@/lib/data";
import { useDashboardData, useQuery } from "@/lib/session";

/** Only same-site paths: `next` must never become an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/";
  return raw;
}

export function LoginView() {
  const { ready, authenticated } = usePrivy();
  const next = safeNext(useSearchParams().get("next"));

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[1160px] items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <div className="grid w-full max-w-[440px] gap-8 justify-self-center lg:justify-self-start">
        <Wordmark size={28} />
        {!ready ? (
          <div className="grid gap-4" aria-busy="true">
            <Skeleton width="80%" height="34px" />
            <Skeleton width="100%" height="44px" />
            <Skeleton width="100%" height="44px" />
          </div>
        ) : authenticated ? (
          <Onboarding next={next} />
        ) : (
          <SignIn />
        )}
      </div>
      <Showcase />
    </main>
  );
}

/* ── Step 1: Privy, by email or Google ──────────────────────────────────── */

function SignIn() {
  const { login } = useLogin();
  const { initOAuth, state: oauth } = useLoginWithOAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("That doesn't look like an email address.");
      return;
    }
    // Privy's modal sends and checks the one-time code (and any bot check).
    login({ loginMethods: ["email"], ...(value ? { prefill: { type: "email" as const, value } } : {}) });
  }

  async function withGoogle() {
    setError(null);
    try {
      await initOAuth({ provider: "google" });
    } catch {
      setError("Google sign-in didn't start. Try again, or use your email.");
    }
  }

  return (
    <div className="grid gap-7">
      <div className="grid gap-3">
        <h1 className="page-title text-[34px] sm:text-[38px]">Get paid in full, in dollars, in under a second.</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Sign in to create payment links, follow every Pay in 4 plan and move your money. New here? The same step creates
          your account.
        </p>
      </div>

      <div className="grid gap-3">
        <Button
          variant="secondary"
          size="lg"
          onClick={withGoogle}
          loading={oauth.status === "loading"}
          icon={<GoogleMark />}
        >
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 py-1 text-[12.5px] text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line-strong" />
          or
          <span className="h-px flex-1 bg-line-strong" />
        </div>

        <form onSubmit={withEmail} noValidate className="grid gap-3">
          <Field label="Work email" htmlFor="login-email">
            <TextInput
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={Boolean(error)}
            />
          </Field>
          <Button type="submit" size="lg" icon={<Mail className="size-4" aria-hidden />}>
            Continue with email
          </Button>
        </form>
        {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted">
        Sign-in is by Privy. Your account comes with its own payout account on Monad, which only you control.
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

/* ── Step 2: name the business, then in ─────────────────────────────────── */

function Onboarding({ next }: { next: string }) {
  const router = useRouter();
  const data = useDashboardData();
  const { logout } = usePrivy();
  const { data: merchant, error, reload } = useQuery((d) => d.getMerchant());
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
      setFormError("Enter your business name, as buyers should see it.");
      return;
    }
    setBusy(true);
    try {
      await data.updateMerchant({ businessName: value });
      router.replace(next);
    } catch (err) {
      setFormError(err instanceof DataError ? err.message : "We couldn't save that. Try again.");
      setBusy(false);
    }
  }

  if (error && !merchant) {
    return (
      <div className="grid gap-4">
        <InlineMessage tone="error">{error}</InlineMessage>
        <div className="flex gap-2">
          <Button onClick={reload}>Try again</Button>
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (!merchant || named) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Opening your dashboard">
        <Skeleton width="70%" height="34px" />
        <Skeleton width="100%" height="44px" />
      </div>
    );
  }

  return (
    <form onSubmit={save} noValidate className="grid gap-7">
      <div className="grid gap-3">
        <h1 className="page-title text-[34px] sm:text-[38px]">What&rsquo;s your business called?</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Buyers see it on every link, checkout and receipt. That&rsquo;s the whole setup: your payout account already
          exists.
        </p>
      </div>
      <Field label="Business name" htmlFor="business-name" error={formError}>
        <TextInput
          id="business-name"
          autoComplete="organization"
          placeholder="Studio Sol"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          invalid={Boolean(formError)}
          aria-describedby={formError ? "business-name-error" : undefined}
          autoFocus
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={busy}>
          Open the dashboard
        </Button>
        <Button variant="ghost" onClick={() => void logout()}>
          Use another account
        </Button>
      </div>
    </form>
  );
}

/* ── The showcase: the consumer app's card stack, for merchants ─────────── */

function Showcase() {
  return (
    <aside aria-label="What you get" className="grid w-full max-w-[460px] gap-8 justify-self-center">
      <div className="relative h-[250px] sm:h-[280px]" aria-hidden>
        {/* Back: the ink card. */}
        <div className="absolute inset-x-6 top-0 h-[200px] overflow-hidden rounded-[24px] bg-[#181818] p-5 text-white sm:h-[218px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] text-white/70">
              Pay in 4 <span className="figure ml-1.5 text-white">4 × $50.38</span>
            </span>
            <span className="text-[15px] font-black tracking-[-0.02em] italic">POLARIS</span>
          </div>
          <Emboss color="#181818" />
        </div>
        {/* Front: the lime card. */}
        <div className="absolute inset-x-0 bottom-0 h-[200px] overflow-hidden rounded-[24px] bg-lime p-6 text-[#111] shadow-[var(--shadow-float)] sm:h-[218px]">
          <div className="flex items-start justify-between">
            <span className="text-[14px] text-black/70">Paid to you, today</span>
            <span className="text-[15px] font-black tracking-[-0.02em] italic">POLARIS</span>
          </div>
          <p className="figure-display mt-3 text-[40px]">$200.00</p>
          <span className="mt-3 inline-flex h-7 items-center rounded-full bg-[#111] px-3 text-[12.5px] font-medium text-white">
            Settled in 0.8 s
          </span>
          <Emboss color="#b3de00" />
        </div>
      </div>

      <ul className="grid gap-3 text-[14px] leading-relaxed">
        {[
          ["One link, three ways to pay.", "In full, in four instalments, or on a subscription."],
          ["Paid in full at checkout.", "With Pay in 4, collections and the credit risk are ours."],
          ["Withdraw in one tap.", "To any address, with no network fee to pay."],
        ].map(([title, body]) => (
          <li key={title} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
            <span aria-hidden className="mt-[7px] size-2 rounded-full bg-lime" />
            <span>
              <span className="font-medium">{title}</span> <span className="text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The giant embossed wordmark bleeding off a card's bottom edge. */
function Emboss({ color }: { color: string }) {
  return (
    <span
      className="wordmark pointer-events-none absolute -bottom-[34px] -left-2 text-[128px] select-none"
      style={{
        color,
        textShadow: "-1px -1px 0 rgb(255 255 255 / 0.28), 1.5px 1.5px 0 rgb(0 0 0 / 0.18)",
      }}
    >
      Polaris
    </span>
  );
}
