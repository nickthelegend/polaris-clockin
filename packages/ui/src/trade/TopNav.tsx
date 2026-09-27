"use client";

import { ChevronDown, Menu as MenuIcon } from "lucide-react";
import { useState, type ElementType, type ReactNode } from "react";

import { LogoMark } from "../primitives/Logo";
import { cn } from "../lib/cn";
import { IconSlot } from "../lib/icon";
import { pressable } from "../primitives/Button";
import { Menu } from "../primitives/Menu";
import { toast } from "../primitives/Toast";
import { BottomSheet, Sheet } from "../overlays/BottomSheet";
import { IconSquareButton } from "./Buttons";

export type TopNavItem = {
  key: string;
  label: string;
  href: string;
  /** Shown in the phone sheet and the dropdown. */
  icon?: ReactNode;
  /** A line under the label in the dropdown. */
  description?: string;
};

/* ── NavLink ─────────────────────────────────────────────────────────────── */

export type NavLinkProps = {
  href: string;
  active?: boolean;
  linkAs?: ElementType;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
};

/**
 * A top-nav text link ("Dashboard", "Trade"): 15px medium, white; the page
 * you are on turns lime.
 */
export function NavLink({ href, active = false, linkAs: Link = "a", children, className, onClick }: NavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-10 items-center rounded-[10px] font-satoshi text-[15px] font-medium whitespace-nowrap transition-colors duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus",
        active ? "text-ui-lime-active" : "text-ui-text hover:text-ui-lime-active",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ── NavDropdown ─────────────────────────────────────────────────────────── */

export type NavDropdownProps = {
  label: string;
  items: TopNavItem[];
  /** The active item's key: the dropdown's label turns lime when it is inside. */
  value?: string;
  linkAs?: ElementType;
  align?: "start" | "end";
};

/**
 * "Market ⌄": a text link with a chevron that opens a menu of pages.
 */
export function NavDropdown({ label, items, value, linkAs, align = "start" }: NavDropdownProps) {
  const active = items.some((i) => i.key === value);
  return (
    <Menu
      label={label}
      align={align}
      width={280}
      triggerClassName="rounded-[10px] active:scale-100"
      trigger={
        <span
          className={cn(
            "inline-flex h-10 items-center gap-2 font-satoshi text-[15px] font-medium whitespace-nowrap transition-colors",
            active ? "text-ui-lime-active" : "text-ui-text hover:text-ui-lime-active",
          )}
        >
          {label}
          <ChevronDown aria-hidden size={16} strokeWidth={1.75} className="opacity-80" />
        </span>
      }
    >
      {items.map((item) => (
        <Menu.Item
          key={item.key}
          href={item.href}
          linkAs={linkAs}
          icon={item.icon}
          description={item.description}
          aria-current={item.key === value ? "page" : undefined}
          className={item.key === value ? "text-ui-lime-active" : undefined}
        >
          {item.label}
        </Menu.Item>
      ))}
    </Menu>
  );
}

/* ── WalletPill ──────────────────────────────────────────────────────────── */

export type WalletPillProps = {
  address: string | null;
  /** What the address is, for the button's name and the toast: "payout wallet". */
  label?: string;
  /** The small round icon; the Polaris mark by default. */
  icon?: ReactNode;
  /** While there is no address yet. */
  pendingText?: string;
  /** Longest the pill gets before the address truncates. */
  maxWidth?: number;
  className?: string;
};

/**
 * The dark pill with the wallet: a small icon and the 0x address, cut with
 * an ellipsis. Pressing it copies the full address.
 *
 * ```tsx
 * <WalletPill address={merchant.walletAddress} label="payout wallet" />
 * ```
 */
export function WalletPill({ address, label = "wallet address", icon, pendingText = "Setting up…", maxWidth = 260, className }: WalletPillProps) {
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast({ title: `Copied the ${label}`, description: address, tone: "success", duration: 2400 });
    } catch {
      toast({ title: `We couldn't copy the ${label}`, description: address, tone: "error" });
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!address}
      aria-label={address ? `Copy the ${label}, ${address}` : `The ${label}: ${pendingText}`}
      title={address ?? undefined}
      className={cn(
        "inline-flex h-11 min-w-0 items-center gap-2.5 rounded-full bg-ui-surface-1 pr-5 pl-3.5 font-satoshi text-[15px] font-medium text-ui-text",
        pressable,
        "hover:bg-ui-surface-2 disabled:opacity-70",
        className,
      )}
      style={{ maxWidth }}
    >
      <span aria-hidden className="grid size-6 shrink-0 place-items-center">
        {icon ?? <LogoMark size={20} title="" />}
      </span>
      <span className="ui-figure min-w-0 truncate">{address ?? pendingText}</span>
    </button>
  );
}

/* ── TopNav ──────────────────────────────────────────────────────────────── */

export type TopNavProps = {
  /** The logo, linked to `brandHref`. */
  brand: ReactNode;
  brandHref?: string;
  brandLabel?: string;
  items: TopNavItem[];
  /** "More ⌄": pages behind a dropdown (the reference's "Market"). */
  more?: { label: string; items: TopNavItem[] };
  /** The active item's key. */
  value?: string;
  linkAs?: ElementType;
  /** Right of the links from 1024px: the wallet pill, the lime button, the avatar menu. */
  actions?: ReactNode;
  /** Beside the menu button below 1024px (keep it to one or two icons). */
  compactActions?: ReactNode;
  /** Under the links in the phone menu sheet: the wallet, sign out. */
  sheetFooter?: ReactNode;
  /** The phone sheet's title. */
  sheetTitle?: string;
  className?: string;
};

/**
 * Ref E's top nav, instead of a sidebar: the brand on the left, text links
 * in the middle-right with a "More" dropdown, then the dark wallet pill, the
 * lime pill button and the avatar. Below 1024px it becomes a compact bar
 * whose menu opens as a BottomSheet.
 *
 * ```tsx
 * <TopNav
 *   brand={<Logo height={30} />}
 *   items={nav}
 *   more={{ label: "More", items: [developers] }}
 *   value="overview"
 *   linkAs={Link}
 *   actions={<><WalletPill address={a} /><PrimaryButton size="sm" iconRight={<Plus />}>New link</PrimaryButton></>}
 * />
 * ```
 */
export function TopNav({
  brand,
  brandHref = "/",
  brandLabel = "Home",
  items,
  more,
  value,
  linkAs: Link = "a",
  actions,
  compactActions,
  sheetFooter,
  sheetTitle = "Menu",
  className,
}: TopNavProps) {
  const [open, setOpen] = useState(false);
  const all = [...items, ...(more?.items ?? [])];
  return (
    <header className={cn("relative z-30 font-satoshi", className)}>
      {/* From 1024px: the reference's bar. */}
      <div className="hidden h-[104px] items-center gap-8 px-10 lg:flex xl:h-[112px] xl:px-14">
        <Link href={brandHref} aria-label={brandLabel} className="shrink-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ui-focus">
          {brand}
        </Link>
        <nav aria-label="Main" className="ml-auto">
          <ul className="flex items-center gap-7 xl:gap-11">
            {items.map((item) => (
              <li key={item.key}>
                <NavLink href={item.href} active={item.key === value} linkAs={Link}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            {more ? (
              <li>
                <NavDropdown label={more.label} items={more.items} value={value} linkAs={Link} />
              </li>
            ) : null}
          </ul>
        </nav>
        {actions ? <div className="flex min-w-0 items-center gap-3 xl:gap-4">{actions}</div> : null}
      </div>

      {/* Below 1024px: the compact bar and its sheet. */}
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:hidden">
        <Link href={brandHref} aria-label={brandLabel} className="mr-auto shrink-0 rounded-[12px]">
          {brand}
        </Link>
        {compactActions}
        <IconSquareButton label="Menu" icon={<MenuIcon />} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)} />
      </div>
      <BottomSheet open={open} onOpenChange={setOpen} snapPoints={["half", "full"]} title={sheetTitle}>
        <Sheet.Body className="pb-4">
          <nav aria-label="Main">
            <ul className="grid gap-1.5">
              {all.map((item) => {
                const on = item.key === value;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={on ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex h-14 items-center gap-3.5 rounded-[18px] px-4 text-[17px] font-medium transition-colors",
                        on ? "bg-ui-surface-1 text-ui-lime-active" : "text-ui-text hover:bg-ui-surface-1",
                      )}
                    >
                      {item.icon ? (
                        <IconSlot size={20} className={cn("inline-grid shrink-0 place-items-center", on ? "text-ui-lime-active" : "text-ui-muted")}>
                          {item.icon}
                        </IconSlot>
                      ) : null}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {sheetFooter ? <div className="mt-4 grid gap-3 border-t border-ui-hairline pt-4">{sheetFooter}</div> : null}
        </Sheet.Body>
      </BottomSheet>
    </header>
  );
}
