"use client";

import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { Avatar } from "@/components/avatar";
import { HelpButton } from "@/components/help";
import { Icon, type IconName } from "@/components/icon";
import { InstallHint } from "@/components/install-hint";
import { Sheet } from "@/components/sheet";
import { TabBarSpacer } from "@/components/tab-bar";
import { TabHeader } from "@/components/tab-header";
import { Button, Card, CardTitle, Skeleton } from "@/components/ui";
import { DEV_SIGNER, signOut } from "@/lib/account";
import { useAccountState } from "@/lib/account/hooks";
import { getProfile } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { monthYear } from "@/lib/dates";
import { currencyForLocale, LOCAL_CURRENCIES } from "@/lib/money";
import { setPrefs, useLocale, usePrefs } from "@/lib/prefs";

export function Profile() {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const profile = useData(() => getProfile(owner), [owner]);
  const prefs = usePrefs();
  const locale = useLocale();
  const [forgetOpen, setForgetOpen] = useState(false);
  const nameId = useId();
  const currencyId = useId();

  const name = prefs.name || profile.value?.name || "";
  const autoCurrency = locale ? currencyForLocale(locale) : "USD";

  return (
    <main id="main" className="px-[15px]">
      <TabHeader title="Profile" right={<HelpButton />} />

      {/* You, on the Send to card's row */}
      <Card className="mt-[21px] px-[16.5px] py-[14.5px]">
        <div className="flex items-center gap-[14.5px]">
          {profile.value ? (
            <Avatar name={name || "You"} size={57.5} />
          ) : (
            <Skeleton className="size-[57.5px] rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] leading-[24px] font-medium tracking-[-0.04em]">{name || "Your account"}</p>
            <p className="mt-[2px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">
              {account.status === "none"
                ? "No account on this device yet"
                : profile.value
                  ? `With Polaris since ${monthYear(profile.value.memberSince)}`
                  : " "}
            </p>
          </div>
        </div>
      </Card>

      {account.status === "none" ? (
        <Link
          href="/onboard?next=/profile"
          className="press mt-[13.5px] flex items-center gap-[14.5px] rounded-card bg-promo py-[14.5px] pr-4 pl-[16.5px] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.75)]"
        >
          <span className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime text-on-lime">
            <Icon name="faceId" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-[22px] font-medium tracking-[-0.03em]">This is a sample account</span>
            <span className="block text-[13px] leading-[19px] tracking-[-0.015em] text-[#a6a6a6]">
              Create yours with Face ID. It takes a second.
            </span>
          </span>
          <Icon name="chevronRight" size={20} className="text-white/60" />
        </Link>
      ) : null}

      {/* Security */}
      <Section title="Security">
        <Row
          icon={DEV_SIGNER ? "info" : "faceId"}
          title={DEV_SIGNER ? "Dev signer (this tab only)" : "Face ID"}
          detail={
            DEV_SIGNER
              ? "A test key stands in for Face ID. Never use it for real money."
              : account.status === "ready"
                ? "Open on this device. Every payment still asks for Face ID."
                : account.status === "locked"
                  ? "Your account is on this device. Face ID opens it."
                  : "Your account will live behind Face ID. No password to forget."
          }
        />
        <Row
          icon="shield"
          title="Only you can move your money"
          detail="Polaris never holds a key to your account, and every payment needs your Face ID."
        />
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <div className="py-3">
          <label htmlFor={nameId} className="text-[16px] font-medium tracking-[-0.03em]">
            Your name on links
          </label>
          <p className="text-[14px] tracking-[-0.02em] text-meta">People see it when you send them dollars.</p>
          <input
            id={nameId}
            value={prefs.name}
            placeholder={profile.value?.name ?? "Your name"}
            maxLength={40}
            autoComplete="name"
            onChange={(e) => setPrefs({ name: e.target.value })}
            className="mt-2.5 h-[51.5px] w-full rounded-full bg-key px-5 text-[16px] tracking-[-0.02em] placeholder:text-muted"
          />
        </div>
        <div className="py-3">
          <label htmlFor={currencyId} className="text-[16px] font-medium tracking-[-0.03em]">
            Local currency
          </label>
          <p className="text-[14px] tracking-[-0.02em] text-meta">
            Shown next to dollars, for reference. You always pay in dollars.
          </p>
          <div className="relative mt-2.5">
            <select
              id={currencyId}
              value={prefs.currency ?? ""}
              onChange={(e) => setPrefs({ currency: e.target.value || null })}
              className="h-[51.5px] w-full appearance-none rounded-full bg-key px-5 text-[16px] tracking-[-0.02em]"
            >
              <option value="">Automatic ({autoCurrency})</option>
              {LOCAL_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code === "USD" ? "USD (dollars only)" : code}
                </option>
              ))}
            </select>
            <Icon
              name="chevronDown"
              size={16}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-muted"
            />
          </div>
        </div>
      </Section>

      <div className="mt-[13.5px]">
        <InstallHint />
      </div>

      {account.status === "ready" || account.status === "locked" ? (
        <div className="mt-[13.5px] flex flex-col gap-2">
          {account.status === "ready" ? (
            <Button variant="secondary" icon="logout" onClick={() => signOut()}>
              Log out
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => setForgetOpen(true)}
            className="press mx-auto h-11 rounded-full px-4 text-[15px] tracking-[-0.02em] text-negative"
          >
            Remove from this device
          </button>
        </div>
      ) : null}

      <p className="mt-6 text-center text-[13px] tracking-[-0.01em] text-muted">Polaris 0.1</p>
      <TabBarSpacer />

      <Sheet
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        title="Remove from this device?"
        description="Your account and your money stay safe. To come back, tap I already use Polaris and use Face ID."
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            onClick={() => {
              signOut({ forget: true });
              setForgetOpen(false);
            }}
          >
            Remove
          </Button>
          <Button variant="secondary" onClick={() => setForgetOpen(false)}>
            Keep it
          </Button>
        </div>
      </Sheet>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mt-[13.5px] px-4 pt-4 pb-1.5">
      <CardTitle>{title}</CardTitle>
      <div className="mt-1 divide-y divide-divider">{children}</div>
    </Card>
  );
}

function Row({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-[14.5px] py-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-well text-[#77797c]">
        <Icon name={icon} size={21} strokeWidth={1.5} />
      </span>
      <div className="min-w-0">
        <p className="text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{title}</p>
        <p className="text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{detail}</p>
      </div>
    </div>
  );
}
