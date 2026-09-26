"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { cx } from "./ui";

const tabs: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Home", icon: "navHome" },
  { href: "/activity", label: "Activity", icon: "navActivity" },
  { href: "/cards", label: "Cards", icon: "navCards" },
  { href: "/pay", label: "Pay", icon: "navPay" },
  { href: "/profile", label: "Profile", icon: "navProfile" },
];

/**
 * The floating nav from the reference: a compact ink pill (226×52) holding
 * five small outline icons, no labels. The current tab is full white.
 */
export function TabBar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav
      aria-label="Main"
      className="column-fixed pointer-events-none bottom-0 z-40 flex justify-center pb-[calc(21px+env(safe-area-inset-bottom))]"
    >
      <ul className="pointer-events-auto flex h-[52px] items-center rounded-full bg-nav px-[13px] shadow-float">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href} className="flex">
              <Link
                href={t.href}
                aria-label={t.label}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press grid h-[52px] w-10 place-items-center rounded-full outline-offset-[-6px] focus-visible:outline-white",
                  active ? "text-white" : "text-white/55 hover:text-white/80",
                )}
              >
                <Icon name={t.icon} size={21} strokeWidth={active ? 1.9 : 1.6} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Space so the last row of a tab screen clears the floating nav. */
export function TabBarSpacer() {
  return <div aria-hidden className="h-[calc(92px+env(safe-area-inset-bottom))]" />;
}
