"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowLeftRight,
  CalendarClock,
  CodeXml,
  House,
  Info,
  Landmark,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Merchant } from "@/lib/data/types";
import { shortAddress } from "@/lib/data/format";
import { Wordmark } from "./brand";
import { useTheme, type ThemePreference } from "./theme";
import { CopyButton, cx } from "./ui";

export const NAV = [
  { href: "/", label: "Home", short: "Home", icon: House },
  { href: "/links", label: "Links", short: "Links", icon: Link2 },
  { href: "/payments", label: "Payments", short: "Payments", icon: ArrowLeftRight },
  { href: "/plans", label: "Pay in 4", short: "Pay in 4", icon: CalendarClock },
  { href: "/payouts", label: "Payouts", short: "Payouts", icon: Landmark },
  { href: "/developers", label: "Developers", short: "API", icon: CodeXml },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/* ── Theme choice ───────────────────────────────────────────────────────── */

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemeChoice({ onRail = false }: { onRail?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cx("flex rounded-full p-[3px]", onRail ? "bg-[var(--rail-hover)]" : "bg-pill")}
    >
      {THEMES.map(({ value, label, icon: Icon }) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={cx(
              "press grid h-7 flex-1 place-items-center rounded-full",
              onRail
                ? checked
                  ? "bg-[var(--rail-text)] text-[var(--rail)]"
                  : "text-[var(--rail-muted)] hover:text-[var(--rail-text)]"
                : checked
                  ? "bg-field text-text shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                  : "text-muted hover:text-text",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/* ── Account block ──────────────────────────────────────────────────────── */

function Account({ merchant, onRail = false }: { merchant: Merchant | null; onRail?: boolean }) {
  const { logout } = usePrivy();
  const muted = onRail ? "text-[var(--rail-muted)]" : "text-muted";
  return (
    <div className="grid gap-3">
      <div className="grid min-w-0 gap-0.5">
        <p className={cx("truncate text-[14px] font-semibold", onRail ? "text-[var(--rail-text)]" : "text-text")}>
          {merchant?.businessName ?? "Your business"}
        </p>
        {merchant?.email ? <p className={cx("truncate text-[12.5px]", muted)}>{merchant.email}</p> : null}
      </div>

      <div className="grid gap-1">
        <p className={cx("text-[12px]", muted)}>Payout account</p>
        {merchant?.walletAddress ? (
          <div className="flex items-center justify-between gap-2">
            <span className={cx("machine truncate text-[12.5px]", onRail ? "text-[var(--rail-text)]" : "text-text")} title={merchant.walletAddress}>
              {shortAddress(merchant.walletAddress, 8, 6)}
            </span>
            <CopyButton
              value={merchant.walletAddress}
              label="Copy payout account address"
              iconOnly
              variant={onRail ? "rail" : "ghost"}
            />
          </div>
        ) : (
          <p className={cx("text-[12.5px]", muted)}>Setting up…</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ThemeChoice onRail={onRail} />
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className={cx(
            "press inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
            onRail ? "text-[var(--rail-text)] hover:bg-[var(--rail-hover)]" : "text-text hover:bg-pill",
          )}
        >
          <LogOut className="size-3.5" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  );
}

function NetworkChip({ onRail = false }: { onRail?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
        onRail ? "bg-[var(--rail-hover)] text-[var(--rail-muted)]" : "bg-pill text-muted",
      )}
      title="Payments settle in AUSD on Monad testnet (chain 10143)"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-lime" />
      Monad testnet
    </span>
  );
}

/* ── Desktop rail ───────────────────────────────────────────────────────── */

function Rail({ merchant }: { merchant: Merchant | null }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 p-3 lg:block">
      <div className="flex h-full flex-col rounded-[24px] bg-[var(--rail)] p-4 text-[var(--rail-text)]">
        <Link href="/" className="rounded-[10px] px-2 pt-1 pb-6 no-underline" aria-label="Polaris for Business, home">
          <Wordmark size={24} tone="rail" />
        </Link>

        <nav aria-label="Main" className="grid gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press relative flex h-10 items-center gap-3 rounded-full px-3 text-[14px] font-medium no-underline",
                  active
                    ? "bg-[var(--rail-text)] text-[var(--rail)]"
                    : "text-[var(--rail-muted)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-text)]",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto grid gap-4 border-t border-[var(--rail-line)] pt-4">
          <NetworkChip onRail />
          <Account merchant={merchant} onRail />
        </div>
      </div>
    </aside>
  );
}

/* ── Mobile: top bar, account sheet, floating nav ───────────────────────── */

function initials(name: string | null | undefined) {
  if (!name) return "P";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "P";
}

function MobileBar({ merchant }: { merchant: Merchant | null }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="no-underline" aria-label="Polaris for Business, home">
          <Wordmark size={21} />
        </Link>
        <div className="flex items-center gap-2">
          <NetworkChip />
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls="account-sheet"
            aria-label="Account"
            onClick={() => setOpen((v) => !v)}
            className="press grid size-9 place-items-center rounded-full bg-ink text-[13px] font-semibold text-on-ink"
          >
            {initials(merchant?.businessName)}
          </button>
        </div>
      </div>

      {open ? (
        <div
          ref={panelRef}
          id="account-sheet"
          role="dialog"
          aria-label="Account"
          className="arrive fixed inset-x-3 top-[64px] z-40 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-pop)]"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[12.5px] font-medium text-muted">Account</p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              aria-label="Close account"
              className="press grid size-8 place-items-center rounded-full hover:bg-pill"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <Account merchant={merchant} />
        </div>
      ) : null}
    </header>
  );
}

/** The consumer app's floating black pill, carrying the six destinations. */
function FloatingNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex justify-center px-3 lg:hidden"
    >
      <ul className="flex w-full max-w-[400px] items-center justify-between rounded-full bg-[var(--rail)] p-1.5 shadow-[var(--shadow-float)]">
        {NAV.map(({ href, label, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press flex h-[50px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] leading-none font-medium no-underline",
                  active ? "bg-[var(--rail-text)] text-[var(--rail)]" : "text-[var(--rail-muted)]",
                )}
              >
                <Icon className="size-[19px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                <span className="max-w-full truncate px-0.5" aria-hidden>
                  {short}
                </span>
                <span className="sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ── The frame ──────────────────────────────────────────────────────────── */

export function SampleDataNote() {
  return (
    <p className="mb-6 flex items-start gap-2 text-[12.5px] leading-snug text-muted">
      <Info className="mt-[1px] size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-text">Sample data.</span> Payments, plans and payouts here are examples until
        the indexer is connected. Links, keys and webhooks you create are real.
      </span>
    </p>
  );
}

export function Shell({ merchant, children }: { merchant: Merchant | null; children: React.ReactNode }) {
  return (
    <div className="lg:flex">
      <a
        href="#content"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-on-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Rail merchant={merchant} />
      <MobileBar merchant={merchant} />
      <main id="content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-6 pb-32 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">{children}</div>
      </main>
      <FloatingNav />
    </div>
  );
}
