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
  "press inline-flex items-center justify-center gap-2 rounded-btn font-medium select-none disabled:opacity-45";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-cta text-on-cta",
  secondary: "bg-surface text-fg",
  lime: "bg-lime text-on-lime",
  quiet: "bg-pill text-fg",
  danger: "bg-negative/10 text-negative",
};

const buttonSizes = {
  lg: "h-14 px-6 text-[16px]",
  md: "h-12 px-5 text-[15px]",
  sm: "h-9 px-3.5 text-[14px]",
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
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={size === "sm" ? 18 : 20} /> : null}
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
      {icon ? <Icon name={icon} size={size === "sm" ? 18 : 20} /> : null}
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

/** The 40px round header button: white, hairline ring. */
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
    "press grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-fg ring-1 ring-hairline ring-inset",
    className,
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls}>
        <Icon name={icon} size={20} />
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cls}>
      <Icon name={icon} size={20} />
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

/** The black pill with a lime sparkle: "Pay later" in the header. */
export function ChipLink({ href, icon, children, sparkle }: { href: string; icon: IconName; children: ReactNode; sparkle?: boolean }) {
  return (
    <Link
      href={href}
      className="press relative inline-flex h-10 items-center gap-2 rounded-full bg-chip pr-4 pl-3.5 text-[15px] font-medium text-on-chip"
    >
      <Icon name={icon} size={18} />
      {children}
      {sparkle ? (
        <span className="absolute -top-0.5 -right-0.5 text-lime" aria-hidden>
          <Icon name="star" size={12} />
        </span>
      ) : null}
    </Link>
  );
}

/** Grey pill: "Credit available $500", "Change". */
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-8 items-center gap-1.5 rounded-full bg-pill px-3.5 text-[14px] text-muted", className)}>
      {children}
    </span>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-card bg-surface", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-medium tracking-[-0.01em] text-fg">{children}</h2>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/* ── Page frame ───────────────────────────────────────────────────────── */

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
    <header className="flex h-16 items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)]">
      <div className="w-10">{back !== false ? <BackButton fallback={back} /> : null}</div>
      <h1 className="truncate text-[17px] font-medium tracking-[-0.01em]">{title}</h1>
      <div className="flex w-10 justify-end">{right}</div>
    </header>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-display text-[30px] leading-none font-extrabold tracking-[-0.05em]", className)}>
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
