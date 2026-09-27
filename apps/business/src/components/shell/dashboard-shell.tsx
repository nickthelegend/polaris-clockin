"use client";

import {
  AppFrame,
  Avatar,
  IconSquareButton,
  Menu,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  TopNav,
  WalletPill,
  cn,
  toast,
  type PageHeaderProps,
} from "@polaris/ui";
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
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { BusinessLogo } from "@/components/app/brand";
import { useAuth } from "@/lib/auth-context";
import { shortAddress } from "@/lib/data/format";
import type { Merchant } from "@/lib/data/types";
import { useMerchant } from "@/lib/merchant-context";
import { useSample } from "@/lib/session";
import { markExplicitSignOut } from "@/lib/sign-out";

/** The top nav's links, in the reference's order. */
export const NAV = [
  { key: "overview", label: "Overview", href: "/dashboard", icon: <House /> },
  { key: "payments", label: "Payments", href: "/dashboard/payments", icon: <ArrowLeftRight /> },
  { key: "links", label: "Links", href: "/dashboard/links", icon: <Link2 /> },
  { key: "plans", label: "Pay in 4", href: "/dashboard/plans", icon: <CalendarClock /> },
  { key: "payouts", label: "Payouts", href: "/dashboard/payouts", icon: <Landmark /> },
];

/** Behind "More", like the reference's "Market" dropdown. */
export const MORE = [
  { key: "developers", label: "Developers", href: "/dashboard/developers", icon: <CodeXml />, description: "API keys, webhooks, the SDK" },
  { key: "settings", label: "Settings", href: "/dashboard/settings", icon: <Settings2 />, description: "Business, payout wallet, test mode" },
];

function activeKey(pathname: string): string {
  const hit = [...NAV.slice(1), ...MORE].find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return hit?.key ?? "overview";
}

/**
 * The dashboard frame (ref E): from 1280px a dark rounded panel floating on
 * the lime canvas, full bleed below. A top nav instead of a sidebar: the
 * wordmark, the links with a "More" dropdown, the payout wallet pill, the
 * lime "New link" and the account menu. Below 1024px a compact bar whose
 * menu opens as a sheet.
 */
export function DashboardShell({ merchant, children }: { merchant: Merchant; children: ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const router = useRouter();
  const value = activeKey(pathname);
  const signOut = useSignOut();

  return (
    <AppFrame>
      <a
        href="#content"
        className="sr-only z-[60] rounded-full bg-ui-lime px-4 py-2 font-medium text-ui-on-lime focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopNav
        brand={<BusinessLogo height={30} />}
        brandHref="/dashboard"
        brandLabel="Polaris for Business, overview"
        items={NAV}
        more={{ label: "More", items: MORE }}
        value={value}
        linkAs={Link}
        actions={
          <>
            <WalletPill
              address={merchant.walletAddress}
              label="payout wallet address"
              pendingText="Setting up your wallet…"
              className="hidden xl:inline-flex"
            />
            <PrimaryButton asChild size="sm" iconRight={<Plus />}>
              <Link href="/dashboard/links?new=1">New link</Link>
            </PrimaryButton>
            <AccountMenu merchant={merchant} />
          </>
        }
        compactActions={
          <IconSquareButton label="New payment link" icon={<Plus />} tone="solid" active onClick={() => router.push("/dashboard/links?new=1")} />
        }
        sheetTitle={merchant.businessName ?? "Menu"}
        sheetFooter={
          <>
            <WalletPill address={merchant.walletAddress} label="payout wallet address" maxWidth={640} className="w-full" />
            <SecondaryButton size="md" block icon={<LogOut />} onClick={() => void signOut()}>
              Sign out
            </SecondaryButton>
          </>
        }
      />
      <main id="content" tabIndex={-1} className="px-4 pt-2 pb-16 outline-none sm:px-6 lg:px-10 lg:pt-0 xl:px-14 xl:pb-14">
        <div className="mx-auto w-full max-w-[1480px]">{children}</div>
      </main>
    </AppFrame>
  );
}

function useSignOut() {
  const { logout } = useAuth();
  const router = useRouter();
  return async () => {
    markExplicitSignOut();
    await logout();
    router.replace("/login");
  };
}

/* ── The signed-in merchant's menu ──────────────────────────────────────── */

export function AccountMenu({ merchant }: { merchant: Merchant }) {
  const sample = useSample();
  const signOut = useSignOut();
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

  return (
    <Menu
      label="Account"
      align="end"
      width={300}
      triggerClassName="active:scale-100"
      trigger={
        <span className="flex items-center gap-1.5 rounded-full bg-ui-surface-1 p-1 pr-2.5 transition-colors hover:bg-ui-surface-2">
          <Avatar name={name} tone="honey" size="sm" decorative />
          <ChevronDown aria-hidden size={16} strokeWidth={1.75} className="text-ui-muted" />
        </span>
      }
    >
      <Menu.Header>
        <p className="truncate text-[16px] font-medium">{name}</p>
        {merchant.email ? <p className="truncate text-[13px] text-ui-muted">{merchant.email}</p> : null}
        <span className="mt-2 flex flex-wrap gap-1.5">
          <StatusPill tone="lime" size="sm">
            Test mode
          </StatusPill>
          {sample.on ? (
            <StatusPill tone="amber" size="sm">
              Sample data
            </StatusPill>
          ) : null}
        </span>
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
      <Menu.Item icon={<Settings2 />} href="/dashboard/settings" linkAs={Link}>
        Settings
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
        <Menu.Item
          icon={<FlaskConical />}
          disabled
          description={process.env.NODE_ENV === "development" && sample.reason === "mock" ? "Development mock session" : "This server's demo data"}
        >
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
 * A dashboard page's header in ref E's rhythm: the title at the pair
 * header's weight, a muted line under it, and the page's actions on the
 * right. (The account menu lives in the top nav.)
 */
export function DashboardHeader({ className, ...props }: Omit<PageHeaderProps, "trailing">) {
  return (
    <PageHeader
      actionsAlign="title"
      {...props}
      className={cn("mb-7 pt-2 md:mb-8 [&_h1]:text-[30px] md:[&_h1]:text-[34px] [&_h1]:tracking-[-0.03em]", className)}
    />
  );
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
