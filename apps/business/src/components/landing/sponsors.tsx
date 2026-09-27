"use client";

import { Marquee, Rise } from "@/components/motion";
import { LOGO_SPEED } from "@/components/motion/tokens";
import { sponsors } from "./content";

type GlyphName = (typeof sponsors.items)[number]["glyph"];

/**
 * A simple geometric glyph per name, drawn by us: these are typeset
 * wordmarks, deliberately not the companies' real logos (as on apps/landing).
 */
function Glyph({ name }: { name: GlyphName }) {
  const common = { width: "0.94em", height: "0.94em", viewBox: "0 0 26 26", "aria-hidden": true as const, focusable: false as const };
  switch (name) {
    case "monad":
      return (
        <svg {...common} fill="none">
          <rect x="6" y="6" width="14" height="14" rx="3.5" transform="rotate(45 13 13)" stroke="currentColor" strokeWidth="2.6" />
        </svg>
      );
    case "privy":
      return (
        <svg {...common}>
          <circle cx="13" cy="11" r="8" fill="currentColor" />
          <rect x="9" y="17" width="4.5" height="7" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "chainlink":
      return (
        <svg {...common} fill="none">
          <path d="M13 3.5 21.2 8.2v9.6L13 22.5l-8.2-4.7V8.2L13 3.5Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
        </svg>
      );
    case "agora":
      return (
        <svg {...common} fill="none">
          <circle cx="9.5" cy="13" r="6.5" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="16.5" cy="13" r="6.5" fill="currentColor" />
        </svg>
      );
    case "envio":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="20" height="4" rx="2" fill="currentColor" />
          <rect x="3" y="11" width="14" height="4" rx="2" fill="currentColor" />
          <rect x="3" y="17" width="20" height="4" rx="2" fill="currentColor" />
        </svg>
      );
    case "nansen":
      return (
        <svg {...common}>
          <path d="M13 3.5 23 21.5H3L13 3.5Z" fill="currentColor" />
        </svg>
      );
    case "mera":
      return (
        <svg {...common} fill="none">
          <path d="M4 20V7l9 8 9-8v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** "Built on Monad with …": a pill over an endless row of typeset wordmarks. */
export function Sponsors() {
  return (
    <section aria-label="Built with" className="py-14 lg:py-20">
      <div className="flex flex-col items-center px-4">
        <Rise
          y={14}
          blur={6}
          duration={0.7}
          className="flex min-h-[40px] items-center rounded-full bg-ui-surface-1 px-5 text-center text-[14px] tracking-[-0.01em] text-ui-muted ring-1 ring-white/6 md:text-[16px]"
        >
          {sponsors.pill}
        </Rise>
      </div>
      <Rise y={0} duration={1} delay={0.15} className="mt-9 lg:mt-12">
        <Marquee
          speed={LOGO_SPEED}
          gap="clamp(40px, 4.9vw, 72px)"
          className="mx-auto max-w-[1280px] py-2 [mask-image:linear-gradient(90deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]"
        >
          {sponsors.items.map((item) => (
            <span
              key={item.name}
              className="inline-flex items-center gap-2.5 text-[24px] font-semibold tracking-[-0.04em] whitespace-nowrap text-ui-text/70 lg:text-[30px]"
            >
              <Glyph name={item.glyph} />
              {item.name}
            </span>
          ))}
        </Marquee>
      </Rise>
    </section>
  );
}
