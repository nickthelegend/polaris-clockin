"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { cx } from "./ui";

const STAR =
  "M60 20C63.9 46.6 73.4 56.1 100 60 73.4 63.9 63.9 73.4 60 100 56.1 73.4 46.6 63.9 20 60 46.6 56.1 56.1 46.6 60 20Z";

/** The generated 3D coin. Until the file exists, the drawn one stands in. */
export const COIN_ASSET = "/assets/coin.png";

/**
 * The silver coin from the promo card. It shows `public/assets/coin.png`
 * when that file is there, and the drawn coin underneath until (or unless)
 * it loads, so dropping the file in needs no code change.
 */
export function Coin({ size = 76, className }: { size?: number; className?: string }) {
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // A load or error that happened before hydration never reaches React's handlers.
  useEffect(() => {
    const el = img.current;
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, []);

  return (
    <span className={cx("relative inline-block", className)} style={{ width: size, height: size }} aria-hidden>
      {loaded ? null : <CoinDrawn size={size} />}
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- a static asset that may not exist yet; next/image would 404 loudly
        <img
          ref={img}
          src={COIN_ASSET}
          alt=""
          width={size}
          height={size}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cx("absolute inset-0 size-full object-contain", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}

/** The drawn coin: a tilted disc with the Polaris star struck into it. */
function CoinDrawn({ size }: { size: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 124 124" width={size} height={size} className="absolute inset-0" aria-hidden>
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

const toneClass: Record<CardTone, { card: string; emboss: string; suffix: string }> = {
  lime: { card: "bg-lime text-on-lime", emboss: "emboss-lime", suffix: "text-on-lime/60" },
  ink: { card: "bg-ink-card text-white", emboss: "emboss-ink", suffix: "text-white/55" },
  white: { card: "bg-surface text-[#0b0b0b]", emboss: "emboss-white", suffix: "text-[#0b0b0b]/50" },
};

/**
 * A Polaris card, drawn on the reference's 372×219 card: the name and amount
 * top left, the heavy italic POLARIS mark top right, "•••• 2451" bottom left,
 * and the giant wordmark embossed into the card in its own colour, bleeding
 * off the bottom edge. Everything scales with the card's width.
 */
export function PolarisCard({
  tone,
  label,
  amount,
  suffix,
  last4,
  badge,
  className,
}: {
  tone: CardTone;
  label: string;
  amount: string;
  /** A quieter word after the amount: "available", "locked". */
  suffix?: string;
  last4?: string;
  /** Bottom right, e.g. the "Main card" pill. */
  badge?: ReactNode;
  className?: string;
}) {
  const t = toneClass[tone];
  return (
    <div className={cx("@container relative isolate aspect-[372/219] overflow-hidden rounded-card", t.card, className)}>
      <span aria-hidden className={cx("emboss absolute -bottom-[2.8cqw] -left-[0.3cqw] -z-10 text-[36.3cqw]", t.emboss)}>
        Polaris
      </span>
      <p className="absolute top-[4.7cqw] left-[4.85cqw] text-[4.85cqw] leading-[1.2] tracking-[-0.02em]">{label}</p>
      <p className="absolute top-[12.55cqw] left-[4.85cqw] text-[6.45cqw] leading-[1.15] font-medium tracking-[-0.01em] whitespace-nowrap">
        {amount}
        {suffix ? (
          <span className={cx("ml-[1.3cqw] text-[4.3cqw] font-normal tracking-[-0.02em]", t.suffix)}>{suffix}</span>
        ) : null}
      </p>
      <PolarisMark className="absolute top-[4.15cqw] right-[4.55cqw] text-[5.4cqw]" />
      {last4 ? (
        <p className="absolute bottom-[3.7cqw] left-[4.6cqw] flex items-center text-[4.3cqw] leading-[1.25] font-medium tracking-[-0.01em]">
          <span aria-hidden className="mr-[1.45cqw] flex gap-[0.45cqw]">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="size-[1.15cqw] rounded-full bg-current" />
            ))}
          </span>
          <span className="sr-only">ending </span>
          {last4}
        </p>
      ) : null}
      {badge ? <div className="absolute right-[1.9cqw] bottom-[1.75cqw]">{badge}</div> : null}
    </div>
  );
}

/** The card network mark's place, taken by a heavy italic POLARIS. */
export function PolarisMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("leading-none font-black tracking-[-0.045em] italic", className)}>
      POLARIS
    </span>
  );
}

/** "✓ Main card": the black pill on the selected card. */
export function MainCardPill() {
  return (
    <span className="inline-flex h-[36.5px] items-center gap-[7px] rounded-full bg-chip pr-[14px] pl-[10px] text-[16px] tracking-[-0.02em] text-on-chip">
      <span className="grid size-[16.5px] place-items-center rounded-full bg-white text-black">
        <Icon name="check" size={11} strokeWidth={3} />
      </span>
      Main card
    </span>
  );
}

/** The lime chip beside "Your dollar balance": a card seen from across the room. */
export function CardChip({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("relative inline-block h-[18.5px] w-[28px] overflow-hidden rounded-[3.5px] bg-lime", className)}>
      <span className="absolute top-[3px] right-[3px] h-[3px] w-[5px] rounded-[1px] bg-white/45" />
      <span className="absolute right-[4px] bottom-[3px] left-[3px] h-[5px] rounded-[2px] bg-lime-deep/15 shadow-[0_-0.5px_0_rgb(255_255_255/0.55)]" />
    </span>
  );
}

/**
 * A card thumbnail for "From" rows: the real card, scaled down, so its
 * wordmark and details read as the same object in miniature.
 */
export function CardThumb({ tone = "lime", className }: { tone?: CardTone; className?: string }) {
  return (
    <span aria-hidden className={cx("relative block h-[34px] w-[57px] shrink-0 overflow-hidden rounded-[4px]", className)}>
      <span className="absolute top-0 left-0 block w-[372px] origin-top-left scale-[0.1532]">
        <PolarisCard tone={tone} label="Dollar account" amount="$0.00" last4="2451" />
      </span>
    </span>
  );
}
