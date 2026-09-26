"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Position in a `.rise` stagger (60ms apart). */
export function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/* ── Buttons ──────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "lime" | "quiet" | "danger";

const buttonBase =
  "press inline-flex items-center justify-center gap-2 rounded-btn font-medium tracking-[-0.02em] select-none disabled:opacity-45";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-cta text-on-cta shadow-float",
  secondary: "bg-surface text-fg shadow-surface",
  lime: "bg-lime text-on-lime",
  quiet: "bg-pill-soft text-fg",
  danger: "bg-negative/10 text-negative",
};

/** Heights from the reference: 54 (Send money, Send / Receive), 44, and the 34px "Change" pill. */
const buttonSizes = {
  lg: "h-[54px] px-6 text-[16px]",
  md: "h-11 px-5 text-[15px]",
  sm: "h-[34px] px-4 text-[15px]",
} as const;

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  icon?: IconName;
  block?: boolean;
  /** Shows a busy state and blocks taps; the label should say what's happening. */
  busy?: boolean;
};

export function Button({
  variant = "primary",
  size = "lg",
  icon,
  block,
  busy,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonOwnProps & ComponentProps<"button">) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)}
      {...rest}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "lg",
  icon,
  block,
  className,
  children,
  ...rest
}: Omit<ButtonOwnProps, "busy"> & ComponentProps<typeof Link>) {
  return (
    <Link className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      <span>{children}</span>
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} className={cx("animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** The 41px round header button: a near-white disc lifted off the ground. */
export function CircleButton({
  icon,
  label,
  href,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const cls = cx(
    "press grid size-[41px] shrink-0 place-items-center rounded-full bg-surface text-fg shadow-surface",
    className,
  );
  const glyph = <Icon name={icon} size={icon === "help" ? 22 : 20} strokeWidth={2} />;
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls}>
        {glyph}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cls}>
      {glyph}
    </button>
  );
}

/** Back: history when there is some, else a sensible parent. */
export function BackButton({ fallback = "/", label = "Back" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <CircleButton
      icon="back"
      label={label}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    />
  );
}

/** The black header pill with its sparkle: "Pay later". */
export function ChipLink({ href, icon, children, sparkle }: { href: string; icon: IconName; children: ReactNode; sparkle?: boolean }) {
  return (
    <Link
      href={href}
      className="press relative inline-flex h-10 items-center gap-[7px] rounded-full bg-chip pr-[15px] pl-[13px] text-[16px] font-[450] tracking-[-0.02em] text-on-chip shadow-[0_0_0_1.5px_rgb(255_255_255/0.9)]"
    >
      <Icon name={icon} size={18} strokeWidth={1.6} />
      {children}
      {sparkle ? <Sparkle /> : null}
    </Link>
  );
}

/** The two-star glint on the corner of the header pill. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("pointer-events-none absolute -top-[3px] -right-px text-sparkle", className)}>
      <svg width="17" height="22" viewBox="0 0 16 21" className="overflow-visible">
        <path
          d="M8 .6C8.6 4.4 10.2 6 14 6.6 10.2 7.2 8.6 8.8 8 12.6 7.4 8.8 5.8 7.2 2 6.6 5.8 6 7.4 4.4 8 .6Z"
          fill="currentColor"
          stroke="#fff"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <path d="M11.8 15.3c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" fill="#fbf6c8" />
      </svg>
    </span>
  );
}

/** Grey pill: "Credit available $500". */
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-9 items-center gap-1 rounded-full bg-pill px-4 text-[14px] tracking-[-0.03em] text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-card bg-surface shadow-surface", className)} {...rest}>
      {children}
    </section>
  );
}

/** "Send again", "History": 18px medium, tight, with one action on the right. */
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[27px] items-center justify-between gap-3">
      <h2 className="text-[18px] leading-none font-medium tracking-[-0.04em] text-fg">{children}</h2>
      {action}
    </div>
  );
}

/** The faint "+ Add" pill inside a card. */
export function SoftPill({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(
        "press inline-flex h-[27px] items-center gap-1 rounded-full bg-pill-faint px-3 text-[15px] tracking-[-0.02em] text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** "see more": a quiet text link. */
export function MoreLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link className={cx("text-[14px] tracking-[-0.02em] text-muted hover:text-fg", className)} {...rest}>
      {children}
    </Link>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/* ── Page frame ───────────────────────────────────────────────────────── */

/**
 * The top of every screen sits where the reference's does: a 41px row whose
 * top is 44px down (or just under the status bar, when installed).
 */
export const SCREEN_TOP = "pt-[max(44px,calc(env(safe-area-inset-top)+12px))]";

/** "← Title (?)" for every screen that isn't a tab. */
export function ScreenHeader({
  title,
  back = "/",
  right,
}: {
  title: string;
  back?: string | false;
  right?: ReactNode;
}) {
  return (
    <header className={cx("flex items-center justify-between gap-3", SCREEN_TOP)}>
      <div className="flex h-[41px] w-[41px] items-center">{back !== false ? <BackButton fallback={back} /> : null}</div>
      <h1 className="truncate text-[18px] font-medium tracking-[-0.04em]">{title}</h1>
      <div className="flex w-[41px] justify-end">{right}</div>
    </header>
  );
}

/** The wordmark: 30px, medium and tight, like the reference's logotype. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-display text-[30px] leading-none font-medium tracking-[-0.05em]", className)}>
      Polaris
    </span>
  );
}

/** Screen-reader announcement for async outcomes. */
export function LiveStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {children}
    </p>
  );
}
