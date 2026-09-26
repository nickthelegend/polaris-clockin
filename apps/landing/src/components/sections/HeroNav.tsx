"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReduced } from "@/components/motion/hooks";
import { EASE_REVEAL, WORD_BLUR } from "@/components/motion/tokens";
import { MenuIcon } from "@/components/ui/icons";
import { PolarisMark } from "@/components/ui/Logo";
import { nav, site } from "@/content";

/**
 * The hero's navigation, with its load sequence: the mark scales in, the
 * wordmark writes on letter by letter behind a clip mask, the link pill fades
 * in with its links blurring in, "Get the app" pops in and "Log in" slides
 * out from behind it, and the menu button fades up last.
 */
export function HeroNav({ ready }: { ready: boolean }) {
  const reduced = useReduced();
  const go = ready || reduced;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setMenuOpen(false);
        return;
      }
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <nav
        aria-label="Main"
        className="relative flex items-center justify-between px-4 pt-4 md:px-8 md:pt-6 lg:px-12 lg:pt-[50px]"
      >
        {/* Links pill */}
        <motion.div
          className="rv hidden h-[54px] items-center gap-[27px] rounded-full bg-[rgba(20,17,12,0.42)] px-[26px] backdrop-blur-[14px] lg:flex"
          initial={{ opacity: 0 }}
          animate={go ? { opacity: 1 } : undefined}
          transition={{ delay: 0.08, duration: 0.6, ease: "easeOut" }}
        >
          {nav.links.map((link, i) => (
            <motion.a
              key={link.label}
              href={link.href}
              className="reveal-word text-[17px] tracking-[-0.02em] text-white/95 transition-opacity hover:opacity-70"
              initial={{ opacity: 0, filter: `blur(${WORD_BLUR}px)`, y: 6 }}
              animate={go ? { opacity: 1, filter: "blur(0px)", y: 0 } : undefined}
              transition={{ delay: 0.16 + i * 0.09, duration: 0.7, ease: EASE_REVEAL }}
            >
              {link.label}
            </motion.a>
          ))}
        </motion.div>

        {/* Wordmark: centred on desktop, left on phones */}
        <a
          href="#top"
          aria-label={`${site.name} home`}
          className="flex items-center gap-2 text-white lg:absolute lg:left-1/2 lg:top-[50px] lg:h-[54px] lg:-translate-x-1/2"
        >
          <motion.span
            className="rv inline-flex"
            initial={{ scale: 0, rotate: -45, opacity: 0 }}
            animate={go ? { scale: 1, rotate: 0, opacity: 1 } : undefined}
            transition={{ delay: 0.05, type: "spring", stiffness: 240, damping: 17 }}
          >
            <PolarisMark size={30} />
          </motion.span>
          <motion.span
            className="rv rv-w inline-block overflow-hidden whitespace-nowrap"
            initial={{ width: 0 }}
            animate={go ? { width: "auto" } : undefined}
            transition={{ delay: 0.42, duration: 0.8, ease: EASE_REVEAL }}
          >
            <span className="inline-block pr-[2px] text-[25px] font-semibold tracking-[-0.045em] lg:text-[28px]">
              {site.name.split("").map((ch, i) => (
                <motion.span
                  key={i}
                  className="reveal-word"
                  initial={{ opacity: 0, filter: "blur(6px)" }}
                  animate={go ? { opacity: 1, filter: "blur(0px)" } : undefined}
                  transition={{ delay: 0.45 + i * 0.075, duration: 0.45, ease: "easeOut" }}
                >
                  {ch}
                </motion.span>
              ))}
            </span>
          </motion.span>
        </a>

        {/* Log in / Get the app / menu */}
        <div className="flex items-center gap-2" ref={menuRef}>
          <div className="relative flex items-center">
            <motion.div
              className="rv hidden h-[50px] items-center rounded-full bg-[rgba(20,17,12,0.42)] pl-[22px] pr-[2px] backdrop-blur-[14px] lg:flex"
              initial={{ clipPath: "inset(0% 0% 0% 100% round 999px)" }}
              animate={go ? { clipPath: "inset(0% 0% 0% 0% round 999px)" } : undefined}
              transition={{ delay: 0.55, duration: 0.75, ease: EASE_REVEAL }}
            >
              <motion.a
                href={nav.login.href}
                className="rv text-[17px] tracking-[-0.02em] text-white/95 transition-opacity hover:opacity-70"
                initial={{ x: 70, opacity: 0 }}
                animate={go ? { x: 0, opacity: 1 } : undefined}
                transition={{ delay: 0.6, duration: 0.75, ease: EASE_REVEAL }}
              >
                {nav.login.label}
              </motion.a>
              {/* Reserves the room "Get the app" sits in. */}
              <span aria-hidden="true" className="invisible ml-[14px] px-[22px] text-[17px] tracking-[-0.02em]">
                {nav.cta.label}
              </span>
            </motion.div>
            <motion.a
              href={nav.cta.href}
              className="rv relative z-10 inline-flex h-[42px] items-center rounded-full bg-white px-4 text-[15px] tracking-[-0.02em] text-olive transition-colors hover:bg-lime lg:absolute lg:inset-y-[2px] lg:right-[2px] lg:h-auto lg:px-[22px] lg:text-[17px]"
              initial={{ scale: 0.35, opacity: 0 }}
              animate={go ? { scale: 1, opacity: 1 } : undefined}
              transition={{ delay: 0.04, type: "spring", stiffness: 300, damping: 20 }}
            >
              {nav.cta.label}
            </motion.a>
          </div>

          <motion.button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="rv grid h-[42px] w-[42px] place-items-center rounded-full bg-[rgba(20,17,12,0.42)] text-white backdrop-blur-[14px] transition-colors hover:bg-[rgba(20,17,12,0.6)] lg:h-[50px] lg:w-[50px]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={go ? { opacity: 1, scale: 1 } : undefined}
            transition={{ delay: 0.3, duration: 0.5, ease: EASE_REVEAL }}
          >
            <MenuIcon />
          </motion.button>

          <AnimatePresence>
            {menuOpen ? (
              <motion.div
                id="site-menu"
                className="absolute right-4 top-[68px] w-[240px] origin-top-right rounded-[22px] bg-white p-2 text-olive shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] md:right-8 lg:right-12 lg:top-[116px]"
                initial={{ opacity: 0, scale: 0.94, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.25, ease: EASE_REVEAL }}
              >
                <ul>
                  {[...nav.links, nav.login].map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-[14px] px-4 py-3 text-[17px] tracking-[-0.02em] transition-colors hover:bg-pill"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </nav>
    </header>
  );
}
