"use client";

import { type ReactNode, useId, useState } from "react";
import { Avatar } from "@/components/avatar";
import { HelpButton } from "@/components/help";
import { Icon, type IconName } from "@/components/icon";
import { InstallHint } from "@/components/install-hint";
import { Sheet } from "@/components/sheet";
import { TabBarSpacer } from "@/components/tab-bar";
import { TabHeader } from "@/components/tab-header";
import { Button, ButtonLink, Card, Skeleton } from "@/components/ui";
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
    <main id="main" className="px-4 pt-[calc(env(safe-area-inset-top)+14px)]">
      <TabHeader title="Profile" right={<HelpButton />} />

      <Card className="mt-5 flex items-center gap-4 p-4">
        {profile.value ? <Avatar name={name || "You"} size={60} /> : <Skeleton className="size-[60px] rounded-full" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[22px] font-semibold tracking-[-0.03em]">{name || "Your account"}</p>
          <p className="text-[14px] text-muted">
            {account.status === "none"
              ? "No account on this device yet"
              : profile.value
                ? `With Polaris since ${monthYear(profile.value.memberSince)}`
                : " "}
          </p>
        </div>
      </Card>

      {account.status === "none" ? (
        <ButtonLink href="/onboard?next=/profile" block icon="faceId" className="mt-3">
          Create your account with Face ID
        </ButtonLink>
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
          <label htmlFor={nameId} className="text-[15px] font-medium">
            Your name on links
          </label>
          <p className="text-[13px] text-muted">People see it when you send them dollars.</p>
          <input
            id={nameId}
            value={prefs.name}
            placeholder={profile.value?.name ?? "Your name"}
            maxLength={40}
            autoComplete="name"
            onChange={(e) => setPrefs({ name: e.target.value })}
            className="mt-2 h-12 w-full rounded-[14px] bg-surface-2 px-4 text-[16px] ring-1 ring-hairline ring-inset placeholder:text-muted"
          />
        </div>
        <div className="py-3">
          <label htmlFor={currencyId} className="text-[15px] font-medium">
            Local currency
          </label>
          <p className="text-[13px] text-muted">Shown next to dollars, for reference. You always pay in dollars.</p>
          <select
            id={currencyId}
            value={prefs.currency ?? ""}
            onChange={(e) => setPrefs({ currency: e.target.value || null })}
            className="mt-2 h-12 w-full appearance-none rounded-[14px] bg-surface-2 px-4 text-[16px] ring-1 ring-hairline ring-inset"
          >
            <option value="">Automatic ({autoCurrency})</option>
            {LOCAL_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code === "USD" ? "USD (dollars only)" : code}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <div className="mt-3">
        <InstallHint />
      </div>

      {account.status === "ready" || account.status === "locked" ? (
        <div className="mt-6 flex flex-col gap-3">
          {account.status === "ready" ? (
            <Button variant="secondary" icon="logout" onClick={() => signOut()}>
              Log out
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => setForgetOpen(true)}
            className="press mx-auto h-11 rounded-full px-4 text-[15px] font-medium text-negative"
          >
            Remove from this device
          </button>
        </div>
      ) : null}

      <p className="mt-8 text-center text-[13px] text-muted">Polaris 0.1</p>
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
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-[14px] font-medium text-muted">{title}</h2>
      <Card className="divide-y divide-divider px-4">{children}</Card>
    </section>
  );
}

function Row({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-pill">
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{title}</p>
        <p className="text-[13px] text-muted">{detail}</p>
      </div>
    </div>
  );
}
