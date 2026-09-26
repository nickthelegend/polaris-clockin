"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PolarisCard } from "@/components/art";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon, type IconName } from "@/components/icon";
import { ButtonLink, ScreenHeader, stagger } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { safeNext } from "@/lib/next-path";

const POINTS: Array<{ icon: IconName; text: string }> = [
  { icon: "plans", text: "Pay in full, in four, or every month" },
  { icon: "link", text: "Send dollars anywhere with a link" },
  { icon: "bolt", text: "No fees to move your money" },
];

/** One screen, one Face ID, then straight back to where you were. */
export function Onboard() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const state = useAccountState();

  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="" back={next} right={<HelpButton />} />

      <div className="rise mt-2" style={stagger(0)}>
        <PolarisCard
          tone="lime"
          label="Dollar account"
          amount="$0.00"
          badge={
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-chip px-3 text-[14px] font-medium text-on-chip">
              <Icon name="faceId" size={16} />
              Face ID
            </span>
          }
        />
      </div>

      <h1 className="rise mt-8 font-display text-[34px] leading-[1.02] font-bold tracking-[-0.045em] text-balance" style={stagger(1)}>
        {state.status === "locked" ? "Welcome back" : "Create your account with Face ID"}
      </h1>
      <p className="rise mt-3 text-[16px] text-muted" style={stagger(2)}>
        {state.status === "locked"
          ? "Your Polaris account is on this phone. Face ID opens it."
          : "No password, nothing to write down. Your face opens it, on this phone and your other devices."}
      </p>

      <ul className="rise mt-6 flex flex-col gap-3" style={stagger(3)}>
        {POINTS.map((p) => (
          <li key={p.text} className="flex items-center gap-3 text-[15px]">
            <span className="grid size-9 place-items-center rounded-full bg-surface">
              <Icon name={p.icon} size={18} />
            </span>
            {p.text}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        {state.status === "ready" ? (
          <ButtonLink href={next} block icon="check">
            You&apos;re in. Continue
          </ButtonLink>
        ) : (
          <FaceIdAction
            label="Continue with Face ID"
            newLabel="Create account with Face ID"
            busyLabel="Opening your account…"
            onAccount={async () => {
              router.replace(next);
            }}
          />
        )}
      </div>
    </main>
  );
}
