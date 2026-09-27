"use client";

import { Avatar, Badge, BottomNav, Card, Menu, PageHeader, SideNav, cn, toast, type PageHeaderProps } from "@polaris/ui";
import {
  ArrowLeftRight,
  CalendarClock,
  ChevronDown,
  CodeXml,
  Copy,
  FlaskConical,
  House,
  Landmark,
  Link2,
  LogOut,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { BusinessLogo, BusinessMark } from "@/components/app/brand";
import { useAuth } from "@/lib/auth-context";
import { shortAddress } from "@/lib/data/format";
import type { Merchant } from "@/lib/data/types";
import { useMerchant } from "@/lib/merchant-context";
import { useSample } from "@/lib/session";
import { markExplicitSignOut } from "@/lib/sign-out";

export const NAV = [
  { key: "overview", label: "Overview", href: "/dashboard", icon: <House /> },
  { key: "payments", label: "Payments", href: "/dashboard/payments", icon: <ArrowLeftRight /> },
  { key: "links", label: "Links", href: "/dashboard/links", icon: <Link2 /> },
  { key: "plans", label: "Pay in 4", href: "/dashboard/plans", icon: <CalendarClock /> },
  { key: "payouts", label: "Payouts", href: "/dashboard/payouts", icon: <Landmark /> },
  { key: "developers", label: "Developers", href: "/dashboard/developers", icon: <CodeXml /> },
];

function activeKey(pathname: string): string {
  const hit = NAV.slice(1).find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return hit?.key ?? "overview";
}

/**
 * The dashboard frame: the sidebar (full from 1280px, an icon rail from
 * 768px), a top bar and the floating nav on phones, and the content column.
 */
export function DashboardShell({ merchant, children }: { merchant: Merchant; children: ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const value = activeKey(pathname);
  const sample = useSample();

  return (
    <div className="md:flex">
      <a
        href="#content"
        className="sr-only z-[60] rounded-full bg-ui-lime px-4 py-2 font-medium text-ui-on-lime focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <SideNav
        items={NAV}
        value={value}
        linkAs={Link}
        brand={<BusinessLogo height={30} />}
        brandCompact={<BusinessMark size={30} />}
        brandHref="/dashboard"
        brandLabel="Polaris for Business, overview"
        footer={<ModeCard sample={sample.on} />}
        footerCompact={
          <span
            title={sample.on ? "Test mode on Monad testnet · sample data on" : "Test mode on Monad testnet"}
            className="grid size-12 place-items-center rounded-full bg-ui-surface-2"
          >
            <span aria-hidden className={cn("size-2.5 rounded-full", sample.on ? "bg-[#f5a524]" : "bg-ui-lime")} />
            <span className="sr-only">{sample.on ? "Test mode, sample data on" : "Test mode"}</span>
          </span>
        }
      />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 bg-ui-canvas/85 px-4 backdrop-blur-xl md:hidden">
          <Link href="/dashboard" aria-label="Polaris for Business, overview" className="rounded-[12px]">
            <BusinessLogo height={26} />
          </Link>
          <AccountMenu merchant={merchant} />
        </header>
        <main id="content" tabIndex={-1} className="px-4 pt-3 pb-32 outline-none sm:px-6 md:pt-6 md:pb-14 xl:px-8">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>

      <BottomNav floating size="sm" items={NAV} value={value} linkAs={Link} className="md:hidden" />
    </div>
  );
}

function ModeCard({ sample }: { sample: boolean }) {
  return (
    <Card variant="raised" radius="tile" padding="sm" className="text-[13px]">
      <span className="flex items-center gap-2 font-medium text-ui-text">
        <span aria-hidden className="size-2 rounded-full bg-ui-lime" />
        Test mode
      </span>
      <span className="mt-1 block text-ui-muted">Monad testnet · AUSD</span>
      {sample ? (
        <Badge tone="warn" size="sm" className="mt-2">
          Sample data on
        </Badge>
      ) : null}
    </Card>
  );
}

/* ── The signed-in merchant's menu ──────────────────────────────────────── */

export function AccountMenu({ merchant }: { merchant: Merchant }) {
  const { logout } = useAuth();
  const router = useRouter();
  const sample = useSample();
  const name = merchant.businessName ?? "Your business";

  const copyAddress = async () => {
    if (!merchant.walletAddress) return;
    try {
      await navigator.clipboard.writeText(merchant.walletAddress);
      toast({ title: "Copied the payout address", tone: "success", duration: 2200 });
    } catch {
      toast({ title: "We couldn't copy the address", description: merchant.walletAddress, tone: "error" });
    }
  };

  const signOut = async () => {
    markExplicitSignOut();
    await logout();
    router.replace("/login");
  };

  return (
    <Menu
      label="Account"
      align="end"
      width={300}
      trigger={
        <span className="flex items-center gap-1.5 rounded-full bg-ui-surface-1 p-1 pr-2.5">
          <Avatar name={name} tone="honey" size="sm" decorative />
          <ChevronDown aria-hidden size={16} strokeWidth={1.75} className="text-ui-muted" />
        </span>
      }
    >
      <Menu.Header>
        <p className="truncate text-[16px] font-medium">{name}</p>
        {merchant.email ? <p className="truncate text-[13px] text-ui-muted">{merchant.email}</p> : null}
      </Menu.Header>
      <Menu.Separator />
      <Menu.Item
        icon={<Copy />}
        onSelect={copyAddress}
        disabled={!merchant.walletAddress}
        description={merchant.walletAddress ? shortAddress(merchant.walletAddress, 8, 6) : "Setting up your payout account…"}
      >
        Copy payout address
      </Menu.Item>
      {sample.canToggle ? (
        <Menu.Item
          icon={<Sparkles />}
          keepOpen
          onSelect={() => sample.setPreview(!(sample.reason === "preview"))}
          description="Labelled, and only on this browser"
          trailing={<span className="text-[13px] font-medium">{sample.reason === "preview" ? "On" : "Off"}</span>}
        >
          Preview with sample data
        </Menu.Item>
      ) : sample.on ? (
        <Menu.Item icon={<FlaskConical />} disabled description={
            process.env.NODE_ENV === "development" && sample.reason === "mock" ? "Development mock session" : "This server's demo data"
          }>
          Sample data is on
        </Menu.Item>
      ) : null}
      <Menu.Separator />
      <Menu.Item icon={<LogOut />} tone="danger" onSelect={() => void signOut()}>
        Sign out
      </Menu.Item>
    </Menu>
  );
}

/**
 * A dashboard page's header: the library's PageHeader with the page's
 * actions and, from 768px, the account menu on the right.
 */
export function DashboardHeader(props: Omit<PageHeaderProps, "trailing">) {
  const { merchant } = useMerchant();
  return (
    <PageHeader
      actionsAlign="title"
      {...props}
      className={cn("mb-6 md:mb-8", props.className)}
      trailing={
        <span className="hidden md:inline-flex">
          <AccountMenu merchant={merchant} />
        </span>
      }
    />
  );
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
