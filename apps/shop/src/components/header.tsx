"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { BagIcon, CloseIcon, MenuIcon } from "@/components/icons";
import { Wordmark } from "@/components/wordmark";
import { useShop } from "@/lib/shop-context";

const NAV = [
  { href: "/shop", label: "Shop all" },
  { href: "/shop?category=audio", label: "Audio" },
  { href: "/shop?category=home", label: "Home" },
  { href: "/shop?category=objects", label: "Objects" },
  { href: "/products/coffee-club", label: "Coffee Club" },
];

export function Header() {
  const { count, ready, openDrawer } = useShop();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const inCheckout = pathname.startsWith("/checkout");

  return (
    <header
      className={`sticky top-0 z-40 bg-ground transition-[box-shadow] duration-300 ${
        scrolled ? "shadow-[0_1px_0_var(--color-hair)]" : ""
      }`}
    >
      <div className="mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:h-[72px] lg:px-10">
        <nav aria-label="Main" className="flex items-center">
          <button
            type="button"
            className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
          </button>
          <ul className="hidden items-center gap-7 lg:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-[0.94rem] text-ink-2 transition-colors hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Link href="/" aria-label="Halcyon, home" onClick={() => setMenuOpen(false)} className="justify-self-center rounded-md">
          <Wordmark />
        </Link>

        <div className="flex items-center justify-end">
          {inCheckout ? (
            <Link href="/cart" className="text-[0.94rem] text-ink-2 hover:text-ink">
              Back to bag
            </Link>
          ) : (
            <button
              type="button"
              onClick={openDrawer}
              className="-mr-2 inline-flex h-11 items-center gap-2 rounded-full px-2 text-[0.94rem]"
              aria-label={`Bag, ${count} ${count === 1 ? "item" : "items"}`}
            >
              <span className="hidden sm:inline">Bag</span>
              <span className="relative inline-flex">
                <BagIcon size={22} />
                {ready && count > 0 ? (
                  <motion.span
                    key={count}
                    initial={reduce ? false : { scale: 0.6 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 18 }}
                    className="num absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[11px] font-semibold leading-none text-paper"
                  >
                    {count}
                  </motion.span>
                ) : null}
              </span>
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id="mobile-menu"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-full border-t border-hair bg-ground px-4 pb-8 pt-2 shadow-[0_24px_40px_-24px_rgb(29_28_26/0.25)] lg:hidden"
          >
            <ul className="divide-y divide-hair">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setMenuOpen(false)} className="display flex h-14 items-center text-[1.6rem]">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
