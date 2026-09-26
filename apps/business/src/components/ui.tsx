"use client";

import Link from "next/link";
import { Check, CircleAlert, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState } from "react";

import { moneyParts, money } from "@/lib/data/format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "rail";
type Size = "md" | "sm" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-[var(--ink-hover)]",
  secondary: "bg-field text-text ring-1 ring-inset ring-line-strong hover:ring-[color-mix(in_oklab,var(--text)_28%,transparent)]",
  ghost: "text-text hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)]",
  danger: "bg-danger-wash text-danger-text hover:bg-[color-mix(in_oklab,var(--danger)_18%,transparent)]",
  rail: "text-[var(--rail-text)] hover:bg-[var(--rail-hover)]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-4 text-[14px]",
  lg: "h-12 gap-2 px-6 text-[15px]",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "press inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap select-none",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "press inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap no-underline",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor: string;
  optional?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-text">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="flex items-start gap-1.5 text-[12.5px] text-danger-text" role="alert">
          <CircleAlert className="mt-[2px] size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12.5px] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const INPUT =
  "h-11 w-full rounded-[var(--radius-field)] bg-field px-3.5 text-[14px] text-text ring-1 ring-inset ring-line-strong " +
  "placeholder:text-faint transition-shadow outline-none " +
  "hover:ring-[color-mix(in_oklab,var(--text)_26%,transparent)] " +
  "focus-visible:ring-2 focus-visible:ring-[var(--focus)] " +
  "aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger disabled:opacity-50";

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cx(INPUT, className)} {...rest} />;
  },
);

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT, "appearance-none bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%238b9098' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

/** A radio group drawn as the consumer app's grey pill with a white thumb. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  name: string;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-text">{label}</legend>
      <div className="flex rounded-full bg-pill p-1">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cx(
                "press relative flex h-9 flex-1 cursor-pointer items-center justify-center rounded-full px-3 text-[13px] font-medium",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                checked ? "bg-field text-text shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-text",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A checkbox drawn as a selectable card: used for the ways a buyer may pay. */
export function ChoiceCard({
  checked,
  onChange,
  title,
  detail,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  detail: React.ReactNode;
  id: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cx(
        "press flex cursor-pointer items-start gap-3 rounded-[16px] p-3.5 ring-1 ring-inset",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
        checked ? "bg-field ring-[var(--text)]" : "bg-transparent ring-line-strong hover:ring-[color-mix(in_oklab,var(--text)_30%,transparent)]",
      )}
    >
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span
        aria-hidden
        className={cx(
          "mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-[6px] ring-1 ring-inset transition-colors",
          checked ? "bg-ink text-on-ink ring-transparent" : "ring-line-strong",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="grid gap-0.5">
        <span className="text-[14px] font-medium">{title}</span>
        <span className="text-[12.5px] leading-snug text-muted">{detail}</span>
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  busy,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cx(
        "press relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-[3px] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-ink" : "bg-pill ring-1 ring-inset ring-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid size-[22px] place-items-center rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          checked ? "translate-x-5 bg-on-ink" : "translate-x-0 bg-field",
        )}
      >
        {busy ? <LoaderCircle className="size-3 animate-spin text-muted" /> : null}
      </span>
    </button>
  );
}

/* ── Status ─────────────────────────────────────────────────────────────── */

export type Tone = "live" | "warn" | "danger" | "muted" | "neutral";

const DOT: Record<Tone, string> = {
  live: "bg-lime",
  warn: "bg-warn",
  danger: "bg-danger",
  muted: "bg-faint",
  neutral: "bg-text",
};

const TONE_TEXT: Record<Tone, string> = {
  live: "text-lime-text",
  warn: "text-warn-text",
  danger: "text-danger-text",
  muted: "text-muted",
  neutral: "text-text",
};

/** A status as a dot and a word. Lime means "being collected right now" and nothing else. */
export function Status({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-[13px] font-medium whitespace-nowrap", TONE_TEXT[tone], className)}>
      <span aria-hidden className={cx("size-[7px] shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center rounded-full bg-pill px-2.5 text-[12px] font-medium whitespace-nowrap text-text", className)}>
      {children}
    </span>
  );
}

/**
 * Instalment progress as discrete ticks, because the count is small and
 * exact: "3 of 4 collected", not an approximate bar.
 */
export function Ticks({
  paid,
  total,
  failing = false,
}: {
  paid: number;
  total: number;
  /** The next tick is the one being retried. */
  failing?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="inline-flex items-center gap-[3px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-4 w-[5px] rounded-full",
              i < paid ? "bg-lime" : i === paid && failing ? "bg-warn" : "bg-[color-mix(in_oklab,var(--text)_14%,transparent)]",
            )}
          />
        ))}
      </span>
      <span className="figure text-[13px] text-muted" aria-hidden>
        {paid}/{total}
      </span>
      <span className="sr-only">
        {paid} of {total} instalments collected{failing ? ", the next one is being retried" : ""}
      </span>
    </span>
  );
}

/* ── Money ──────────────────────────────────────────────────────────────── */

/** Dollars with the cents set smaller: for display figures, never in tables. */
export function DisplayMoney({ cents, className }: { cents: number; className?: string }) {
  const parts = moneyParts(cents);
  return (
    <span className={cx("figure-display", className)} aria-label={money(cents)}>
      <span aria-hidden>{parts.dollars}</span>
      <span aria-hidden className="text-[0.52em] tracking-[-0.02em] text-muted">
        .{parts.cents}
      </span>
    </span>
  );
}

/* ── Copy ───────────────────────────────────────────────────────────────── */

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  variant = "secondary",
  className,
  iconOnly = false,
}: {
  value: string;
  label?: string;
  size?: Size;
  variant?: Variant;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard blocked (insecure origin, permissions): select-and-copy fallback.
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  const icon = copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />;
  return (
    <Button
      variant={variant}
      size={size}
      onClick={copy}
      icon={icon}
      aria-label={iconOnly ? `${label}${copied ? " (copied)" : ""}` : undefined}
      className={cx(iconOnly && "w-8 px-0", className)}
    >
      {iconOnly ? null : copied ? "Copied" : label}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </Button>
  );
}

/* ── Page furniture ─────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-7">
      <div className="grid max-w-[62ch] gap-2">
        <h1 className="page-title">{title}</h1>
        {description ? <p className="text-[14px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  children,
  className,
  as: As = "section",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
  labelledBy?: string;
}) {
  return (
    <As className={cx("panel", className)} aria-labelledby={labelledBy}>
      {children}
    </As>
  );
}

export function Skeleton({ width, height = "0.9em", className }: { width: string; height?: string; className?: string }) {
  return <span aria-hidden className={cx("skeleton align-middle", className)} style={{ width, height }} />;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-14 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-muted">{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] bg-danger-wash px-5 py-4">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden />
        <div className="grid gap-0.5">
          <p className="text-[14px] font-medium text-danger-text">We couldn&rsquo;t load this</p>
          <p className="text-[13px] text-text">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** A line of feedback after an action, announced to screen readers. */
export function InlineMessage({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2 text-[13px] leading-snug",
        tone === "error" ? "text-danger-text" : "text-lime-text",
      )}
    >
      {tone === "error" ? <CircleAlert className="mt-[1px] size-3.5 shrink-0" aria-hidden /> : <Check className="mt-[1px] size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

export function useStableId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
