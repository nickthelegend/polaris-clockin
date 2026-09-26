import { type ReactNode, useId } from "react";
import { cx } from "./ui";

const STAR =
  "M60 20C63.9 46.6 73.4 56.1 100 60 73.4 63.9 63.9 73.4 60 100 56.1 73.4 46.6 63.9 20 60 46.6 56.1 56.1 46.6 60 20Z";

/**
 * The silver coin from the promo card: a tilted disc with the Polaris star
 * struck into it. Drawn, so it stays sharp and themable.
 */
export function Coin({ size = 76, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 124 124" width={size} height={size} className={className} aria-hidden>
      <defs>
        <radialGradient id={`face${id}`} cx="34%" cy="28%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#e9ebee" />
          <stop offset="0.72" stopColor="#b7bcc3" />
          <stop offset="1" stopColor="#8a9098" />
        </radialGradient>
        <linearGradient id={`rim${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5f6f7" />
          <stop offset="0.55" stopColor="#9aa0a7" />
          <stop offset="1" stopColor="#5f656c" />
        </linearGradient>
        <linearGradient id={`star${id}`} x1="0.2" y1="0.1" x2="0.8" y2="0.95">
          <stop offset="0" stopColor="#fdfdfd" />
          <stop offset="1" stopColor="#a4a9b0" />
        </linearGradient>
      </defs>
      <g transform="rotate(-14 62 62)">
        <ellipse cx="66" cy="64" rx="50" ry="53" fill={`url(#rim${id})`} />
        <ellipse cx="60" cy="60" rx="50" ry="53" fill={`url(#face${id})`} />
        <ellipse cx="60" cy="60" rx="41" ry="44" fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="1.6" />
        <ellipse cx="61" cy="61.5" rx="41" ry="44" fill="none" stroke="#6f757c" strokeOpacity="0.28" strokeWidth="1.4" />
        <path d={STAR} transform="translate(1.6 2) scale(1 1.05) translate(0 -3)" fill="#6f757c" opacity="0.35" />
        <path d={STAR} transform="scale(1 1.05) translate(0 -3)" fill={`url(#star${id})`} stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1" />
      </g>
    </svg>
  );
}

export type CardTone = "lime" | "ink" | "white";

const toneClass: Record<CardTone, { card: string; emboss: string; muted: string }> = {
  lime: { card: "bg-lime text-on-lime", emboss: "emboss-lime", muted: "text-on-lime/70" },
  ink: { card: "bg-ink-card text-white", emboss: "emboss-ink", muted: "text-white/65" },
  white: { card: "bg-[#fbfbfb] text-[#0b0b0b] ring-1 ring-inset ring-black/5", emboss: "emboss-white", muted: "text-[#0b0b0b]/60" },
};

/**
 * A Polaris card: the account as an object. The giant wordmark is embossed
 * into the card in its own colour and bleeds off the bottom edge.
 */
export function PolarisCard({
  tone,
  label,
  amount,
  last4,
  badge,
  className,
  compact,
}: {
  tone: CardTone;
  label: string;
  amount: string;
  last4?: string;
  badge?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const t = toneClass[tone];
  return (
    <div
      className={cx(
        "relative isolate overflow-hidden rounded-card",
        compact ? "aspect-[372/200]" : "aspect-[372/218]",
        t.card,
        className,
      )}
    >
      <span
        className={cx("emboss absolute -bottom-[0.2em] left-[0.05em] -z-10 text-[clamp(80px,27vw,112px)]", t.emboss)}
        aria-hidden
      >
        Polaris
      </span>
      <div className="flex h-full flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cx("text-[16px] font-medium", t.muted)}>{label}</p>
            <p className="tabular mt-1 font-display text-[26px] font-medium tracking-[-0.03em]">{amount}</p>
          </div>
          <span className="font-display text-[19px] font-black tracking-[-0.02em] italic" aria-hidden>
            POLARIS
          </span>
        </div>
        <div className="flex items-end justify-between gap-3">
          {last4 ? (
            <span className="tabular text-[15px] font-medium">
              <span aria-hidden>•••• </span>
              <span className="sr-only">ending </span>
              {last4}
            </span>
          ) : (
            <span />
          )}
          {badge}
        </div>
      </div>
    </div>
  );
}

/** A tiny lime card for "From: Dollar account" rows and the balance chip. */
export function MiniCard({ className, tone = "lime" }: { className?: string; tone?: CardTone }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative inline-block overflow-hidden rounded-[6px]",
        tone === "lime" ? "bg-lime" : tone === "ink" ? "bg-ink-card" : "bg-[#fbfbfb] ring-1 ring-black/10",
        className,
      )}
    >
      {/* A hint of the card's embossed wordmark: a highlight line over a shade. */}
      <span
        className={cx(
          "absolute right-[18%] bottom-[22%] left-[12%] h-[18%] rounded-full",
          tone === "lime" ? "bg-lime-deep/35 shadow-[0_-1px_0_rgb(255_255_255/0.5)]" : "bg-white/10",
        )}
      />
    </span>
  );
}
