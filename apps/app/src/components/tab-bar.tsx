"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { cx } from "./ui";

const tabs: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/plans", label: "Plans", icon: "plans" },
  { href: "/profile", label: "Profile", icon: "profile" },
];

/**
 * The floating ink pill from the reference, with Pay raised out of its centre
 * as a lime disc: the one action the whole app exists for.
 */
export function TabBar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [left, right] = [tabs.slice(0, 2), tabs.slice(2)];

  const tab = (t: (typeof tabs)[number]) => {
    const active = isActive(t.href);
    return (
      <li key={t.href} className="flex">
        <Link
          href={t.href}
          aria-label={t.label}
          aria-current={active ? "page" : undefined}
          className={cx(
            "press relative grid h-14 w-12 place-items-center rounded-full outline-offset-[-4px] focus-visible:outline-white",
            active ? "text-white" : "text-white/60 hover:text-white/85",
          )}
        >
          <Icon name={t.icon} size={22} strokeWidth={active ? 2 : 1.75} />
          <span
            aria-hidden
            className={cx(
              "absolute bottom-2 size-1 rounded-full bg-lime transition-opacity duration-200",
              active ? "opacity-100" : "opacity-0",
            )}
          />
        </Link>
      </li>
    );
  };

  const payActive = pathname === "/pay";
  return (
    <nav
      aria-label="Main"
      className="column-fixed pointer-events-none bottom-0 z-40 flex justify-center pb-[calc(16px+env(safe-area-inset-bottom))]"
    >
      <ul className="pointer-events-auto relative flex items-center gap-1 rounded-full bg-nav px-2 shadow-float ring-1 ring-white/5">
        {left.map(tab)}
        <li className="flex w-[68px] justify-center">
          <Link
            href="/pay"
            aria-label="Pay or scan"
            aria-current={payActive ? "page" : undefined}
            className="press -mt-7 grid size-[60px] place-items-center rounded-full bg-lime text-on-lime shadow-[0_8px_20px_rgb(0_0_0/0.22)] ring-[5px] ring-[var(--bg-bottom)] focus-visible:outline-offset-4"
          >
            <Icon name="scan" size={26} strokeWidth={2} />
          </Link>
        </li>
        {right.map(tab)}
      </ul>
    </nav>
  );
}

/** Space so the last row of a tab screen clears the floating bar. */
export function TabBarSpacer() {
  return <div aria-hidden className="h-[calc(112px+env(safe-area-inset-bottom))]" />;
}
