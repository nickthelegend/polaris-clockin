"use client";

import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import type { OpenCheckoutOptions, PayResult, PayStatus, Polaris, SessionSource } from "./browser";
import { isPolarisError, type PolarisError } from "./errors";
import { formatUsd, quotePayIn4, toCents, formatCents, type AmountInput } from "./money";
import type { Address, CheckoutResult } from "./types";

/**
 * React half of polarispay-sdk 0.3.0. Every component takes its colours,
 * font and radius from CSS variables, so it sits inside any store:
 *
 *   --polaris-font     --polaris-text     --polaris-muted
 *   --polaris-ink      --polaris-accent   --polaris-radius
 *   --polaris-surface  --polaris-focus
 */

const MARK_VIEWBOX = "16 12 520 580";
const MARK_OUTER =
  "M272.75 19.25 C234.43 201.65 229.25 269.62 24.75 309.00 C203.59 340.32 230.25 429.07 273.00 585.00 C318.08 425.91 340.04 338.84 524.50 309.00 C319.50 272.76 312.50 200.32 272.75 19.25Z";
const MARK_INNER =
  "M272.75 52.25 C266.92 210.23 239.78 285.35 71.25 307.25 C209.40 327.64 260.85 393.28 272.75 530.50 C285.19 395.19 337.69 324.22 477.50 307.75 C304.53 284.01 284.32 212.19 272.75 52.25Z";

const CSS = `
.plrs{font-family:var(--polaris-font,inherit);color:var(--polaris-text,currentColor)}
.plrs-mark{display:inline-block;width:.92em;height:1.02em;vertical-align:-.16em;flex:none}
.plrs-lockup{display:inline;font-weight:650;letter-spacing:-.01em;white-space:nowrap}
.plrs-lockup .plrs-mark{margin-right:.26em}
.plrs-msg{position:relative;margin:0;line-height:1.5}
.plrs-msg strong{font-weight:600}
.plrs-link{appearance:none;background:none;border:0;padding:0;margin:0 0 0 .35em;font:inherit;color:inherit;text-decoration:underline;text-underline-offset:.22em;text-decoration-thickness:1px;cursor:pointer;border-radius:4px}
.plrs-link:hover{text-decoration-thickness:2px}
.plrs :focus-visible{outline:2px solid var(--polaris-focus,#2E8C0A);outline-offset:3px}
.plrs-pop{position:absolute;z-index:60;left:0;top:calc(100% + 10px);width:min(360px,calc(100vw - 32px));background:var(--polaris-ink,#0F1011);color:#F5F5F5;border-radius:var(--polaris-radius,16px);padding:20px 20px 18px;box-shadow:0 24px 60px -18px rgba(15,16,17,.45),0 2px 8px rgba(15,16,17,.18);transform-origin:top left;animation:plrs-in .22s cubic-bezier(.16,1,.3,1)}
.plrs-pop[data-side=above]{top:auto;bottom:calc(100% + 10px);transform-origin:bottom left}
@keyframes plrs-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.plrs-pop{animation:none}}
.plrs-pop h3{margin:14px 0 6px;font-size:19px;line-height:1.2;font-weight:650;letter-spacing:-.015em}
.plrs-pop p{margin:0;color:rgba(245,245,245,.72);font-size:14px;line-height:1.5}
.plrs-sched{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:16px 0 14px}
.plrs-sched li{list-style:none;display:grid;gap:6px;font-size:12px;color:rgba(245,245,245,.62)}
.plrs-sched b{display:block;color:#F5F5F5;font-size:14px;font-weight:600}
.plrs-bar{height:4px;border-radius:4px;background:rgba(245,245,245,.14)}
.plrs-bar[data-now]{background:var(--polaris-accent,#BFFA62)}
.plrs-facts{margin:0;padding:12px 0 0;border-top:1px solid rgba(245,245,245,.1);display:grid;gap:7px}
.plrs-facts li{list-style:none;display:flex;gap:9px;align-items:baseline;font-size:13.5px;color:rgba(245,245,245,.82)}
.plrs-facts li::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--polaris-accent,#BFFA62);transform:translateY(-1px)}
.plrs-close{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(245,245,245,.08);color:#F5F5F5;cursor:pointer;display:grid;place-items:center}
.plrs-close:hover{background:rgba(245,245,245,.16)}
.plrs-fine{margin-top:12px!important;font-size:12px!important;color:rgba(245,245,245,.5)!important}
.plrs-btn{appearance:none;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.55em;width:100%;min-height:54px;padding:0 22px;border-radius:var(--polaris-radius,999px);background:var(--polaris-ink,#0F1011);color:#F5F5F5;font:inherit;font-family:var(--polaris-font,inherit);font-weight:600;font-size:16px;letter-spacing:-.005em;transition:transform .2s cubic-bezier(.16,1,.3,1),background-color .2s,opacity .2s}
.plrs-btn:hover:not(:disabled){background:#1f2123}
.plrs-btn:active:not(:disabled){transform:scale(.985)}
.plrs-btn:disabled{cursor:default;opacity:.72}
.plrs-btn .plrs-mark{width:1.05em;height:1.15em}
.plrs-spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(245,245,245,.25);border-top-color:var(--polaris-accent,#BFFA62);animation:plrs-spin .8s linear infinite}
@keyframes plrs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.plrs-spin{animation-duration:2.4s}}
`;

function Styles() {
  return (
    <style href="polarispay-sdk-react" precedence="low">
      {CSS}
    </style>
  );
}

export function PolarisMark({ title = "Polaris", className }: { title?: string; className?: string }) {
  const labelled = title !== "";
  return (
    <>
    <Styles />
    <svg
      className={["plrs-mark", className].filter(Boolean).join(" ")}
      viewBox={MARK_VIEWBOX}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? title : undefined}
    >
      <path fill="#2E8C0A" d={MARK_OUTER} />
      <path fill="#BFFA62" stroke="#1F6B0A" strokeOpacity={0.55} strokeWidth={2} strokeLinejoin="round" d={MARK_INNER} />
    </svg>
    </>
  );
}

export function PolarisLockup({ className }: { className?: string }) {
  return (
    <span className={["plrs-lockup", className].filter(Boolean).join(" ")}>
      <PolarisMark title="" />
      Polaris
    </span>
  );
}

/* ── On-site messaging ─────────────────────────────────────────────────── */

export type PolarisMessagingProps = {
  amount: AmountInput;
  /** Buyer APR in basis points; 0 (the default here) is interest-free, merchant-funded. */
  aprBps?: number;
  className?: string;
};

const WEEK_LABELS = ["Today", "In 1 week", "In 2 weeks", "In 3 weeks"];

/** "or 4 payments of $87.25 with Polaris. Learn more", with the explainer in a popover. */
export function PolarisMessaging({ amount, aprBps = 0, className }: PolarisMessagingProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ side: "below" | "above"; shift: number }>({ side: "below", shift: 0 });
  const popId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const valid = safeCents(amount);
  const quote = valid ? quotePayIn4(formatCents(valid), { aprBps }) : null;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close only the popover, not a drawer or dialog it sits in.
        e.stopImmediatePropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open && wrapRef.current) {
      // Open below unless there's clearly more room above, and keep it on screen sideways.
      const rect = wrapRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const width = Math.min(360, window.innerWidth - 32);
      const overflow = rect.left + width - (window.innerWidth - 16);
      setPlace({ side: below < 400 && rect.top > below ? "above" : "below", shift: overflow > 0 ? -overflow : 0 });
    }
    setOpen((v) => !v);
  };

  if (!quote) return null;
  const each = formatUsd(quote.each);

  return (
    <div ref={wrapRef} className={["plrs", "plrs-msg", className].filter(Boolean).join(" ")}>
      <Styles />
      <span>
        or 4 payments of <strong>{each}</strong> with <PolarisLockup />
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="plrs-link"
        aria-expanded={open}
        aria-controls={popId}
        onClick={toggle}
      >
        Learn more
      </button>
      {open ? (
        <div
          id={popId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${popId}-title`}
          className="plrs-pop"
          data-side={place.side}
          style={{ left: place.shift }}
        >
          <button
            ref={closeRef}
            type="button"
            className="plrs-close"
            aria-label="Close"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <PolarisLockup />
          <h3 id={`${popId}-title`}>{quote.interestFree ? "Pay in 4, interest-free." : "Pay in 4."}</h3>
          <p>
            Split {formatUsd(quote.principal)} into 4 payments of {each}: one today, then one every week.
          </p>
          <ol className="plrs-sched" aria-label="Payment schedule">
            {quote.installments.map((inst, i) => (
              <li key={inst.index}>
                <span className="plrs-bar" data-now={i === 0 ? "" : undefined} />
                <b>{formatUsd(inst.amount)}</b>
                {WEEK_LABELS[i] ?? `In ${i} weeks`}
              </li>
            ))}
          </ol>
          <ul className="plrs-facts">
            <li>An instant decision when you check out</li>
            <li>
              {quote.interestFree
                ? "No interest, and no fees when you pay on time"
                : `${formatUsd(quote.interest)} of interest in total, shown before you confirm`}
            </li>
            <li>Confirm with Face ID. No card, no forms</li>
          </ul>
          <p className="plrs-fine">Subject to approval. Choose Polaris at checkout.</p>
        </div>
      ) : null}
    </div>
  );
}

function safeCents(amount: AmountInput): bigint | null {
  try {
    return toCents(amount);
  } catch {
    return null;
  }
}

/* ── Hosted checkout ───────────────────────────────────────────────────── */

export type CheckoutState = "idle" | "opening" | "open" | "complete" | "canceled" | "closed" | "redirected" | "error";

/**
 * Open the hosted checkout and track what happened, for a store that draws
 * its own button. `open` resolves with the result (null if a checkout is
 * already open) and rejects if the session couldn't be created or opened.
 */
export function usePolarisCheckout(polaris: Polaris | null) {
  const [state, setState] = useState<CheckoutState>("idle");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState<PolarisError | Error | null>(null);
  const busy = useRef(false);

  const open = useCallback(
    async (source: SessionSource, options?: OpenCheckoutOptions): Promise<CheckoutResult | null> => {
      if (!polaris || busy.current) return null;
      busy.current = true;
      setError(null);
      setResult(null);
      setState("opening");
      try {
        const pending = polaris.openCheckout(
          async () => {
            const value = typeof source === "function" ? await source() : await source;
            setState("open");
            return value;
          },
          options,
        );
        const outcome = await pending;
        setResult(outcome);
        setState(outcome.status);
        return outcome;
      } catch (e) {
        setError(e as Error);
        setState("error");
        throw e;
      } finally {
        busy.current = false;
      }
    },
    [polaris],
  );

  const reset = useCallback(() => {
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  return { open, state, result, error, reset };
}

export type PolarisCheckoutButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "onError"> & {
  polaris: Polaris | null;
  /** The session, or a function that creates it. Called inside the click, so the popup isn't blocked. */
  session: SessionSource;
  options?: OpenCheckoutOptions;
  onResult?: (result: CheckoutResult) => void;
  onError?: (error: Error) => void;
  children?: ReactNode;
};

export function PolarisCheckoutButton({ polaris, session, options, onResult, onError, children, disabled, className, ...rest }: PolarisCheckoutButtonProps) {
  const { open, state } = usePolarisCheckout(polaris);
  const working = state === "opening" || state === "open";
  return (
    <>
      <Styles />
      <button
        type="button"
        {...rest}
        className={["plrs", "plrs-btn", className].filter(Boolean).join(" ")}
        disabled={disabled || working || !polaris}
        aria-busy={working || undefined}
        onClick={async () => {
          try {
            const outcome = await open(session, options);
            if (outcome) onResult?.(outcome);
          } catch (e) {
            onError?.(e as Error);
          }
        }}
      >
        {working ? <span className="plrs-spin" aria-hidden="true" /> : <PolarisMark title="" />}
        {working ? (state === "open" ? "Finish in the Polaris window" : "Opening Polaris…") : (children ?? "Continue with Polaris")}
      </button>
    </>
  );
}

/* ── Direct wallet payment ─────────────────────────────────────────────── */

export type PayButtonState =
  | "idle"
  | PayStatus
  | "rejected"
  | "wrong_network"
  | "no_wallet"
  | "error";

export type PolarisPayButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "onError"> & {
  polaris: Polaris | null;
  amount: AmountInput;
  merchant?: Address;
  orderId?: string;
  /** Create the order at click time and return its id (and the merchant, if it's the server's to choose). */
  prepare?: () => Promise<{ orderId: string; merchant?: Address; amount?: AmountInput }>;
  onStateChange?: (state: PayButtonState, error?: PolarisError | Error) => void;
  onSubmitted?: (result: PayResult & { orderId: string }) => void;
  children?: ReactNode;
};

const PAY_LABELS: Partial<Record<PayButtonState, string>> = {
  connecting: "Connecting to your wallet…",
  switching_network: "Switch network in your wallet…",
  signing: "Confirm in your wallet…",
  relaying: "Sending, gas-free…",
  submitting: "Sending…",
  submitted: "Payment sent",
  rejected: "Try again",
  wrong_network: "Switch network and pay",
  error: "Try again",
};

export function PolarisPayButton({
  polaris,
  amount,
  merchant,
  orderId,
  prepare,
  onStateChange,
  onSubmitted,
  children,
  disabled,
  className,
  ...rest
}: PolarisPayButtonProps) {
  const [state, setState] = useState<PayButtonState>("idle");
  const busy = state !== "idle" && state !== "rejected" && state !== "wrong_network" && state !== "no_wallet" && state !== "error";

  const move = useCallback(
    (next: PayButtonState, error?: PolarisError | Error) => {
      setState(next);
      onStateChange?.(next, error);
    },
    [onStateChange],
  );

  return (
    <>
      <Styles />
      <button
        type="button"
        {...rest}
        className={["plrs", "plrs-btn", className].filter(Boolean).join(" ")}
        disabled={disabled || busy || !polaris}
        aria-busy={busy || undefined}
        onClick={async () => {
          if (!polaris) return;
          try {
            move("connecting");
            const prepared = prepare ? await prepare() : null;
            const id = prepared?.orderId ?? orderId;
            const to = prepared?.merchant ?? merchant;
            if (!id || !to) throw new Error("PolarisPayButton needs an orderId and a merchant, or a prepare() that returns them.");
            const result = await polaris.pay({
              merchant: to,
              amount: prepared?.amount ?? amount,
              orderId: id,
              onStatus: (s) => move(s),
            });
            onSubmitted?.({ ...result, orderId: id });
          } catch (e) {
            const err = e as PolarisError | Error;
            const code = isPolarisError(err) ? err.code : null;
            move(code === "user_rejected" ? "rejected" : code === "wrong_network" ? "wrong_network" : code === "no_wallet" ? "no_wallet" : "error", err);
          }
        }}
      >
        {busy && state !== "submitted" ? <span className="plrs-spin" aria-hidden="true" /> : null}
        {PAY_LABELS[state] ?? children ?? `Pay ${formatUsd(amount)} from your wallet`}
      </button>
    </>
  );
}
