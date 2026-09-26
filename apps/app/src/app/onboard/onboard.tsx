"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PolarisCard } from "@/components/art";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon, type IconName } from "@/components/icon";
import { ButtonLink, Card, ScreenHeader, stagger } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { safeNext } from "@/lib/next-path";

const POINTS: Array<{ icon: IconName; title: string; meta: string }> = [
  { icon: "calendar", title: "Pay now, in four, or monthly", meta: "Every payment shown before you confirm" },
  { icon: "link", title: "Send dollars with a link", meta: "Anyone, anywhere, in under a second" },
  { icon: "bolt", title: "No fees to move your money", meta: "Polaris covers the network costs" },
];

/** One screen, one Face ID, then straight back to where you were. */
export function Onboard() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const state = useAccountState();

  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(20.5px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="" back={next} right={<HelpButton />} />

      <div className="rise mt-[21px]" style={stagger(0)}>
        <PolarisCard
          tone="lime"
          label="Dollar account"
          amount="$0.00"
          badge={
            <span className="inline-flex h-[36.5px] items-center gap-[7px] rounded-full bg-chip pr-[14px] pl-[11px] text-[16px] tracking-[-0.02em] text-on-chip">
              <Icon name="faceId" size={18} strokeWidth={1.7} />
              Face ID
            </span>
          }
        />
      </div>

      <h1
        className="rise mt-7 font-display text-[30px] leading-[1.08] font-medium tracking-[-0.05em] text-balance"
        style={stagger(1)}
      >
        {state.status === "locked" ? "Welcome back" : "Create your account with Face ID"}
      </h1>
      <p className="rise mt-2.5 text-[16px] leading-[1.4] tracking-[-0.02em] text-muted" style={stagger(2)}>
        {state.status === "locked"
          ? "Your Polaris account is on this phone. Face ID opens it."
          : "No password, nothing to write down. Your face opens it, on this phone and your other devices."}
      </p>

      <Card className="rise mt-5 px-4 py-[7.25px]" style={stagger(3)}>
        <ul>
          {POINTS.map((p) => (
            <li key={p.title} className="flex h-[70.5px] items-center gap-[14.5px]">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-well text-[#77797c]">
                <Icon name={p.icon} size={26} strokeWidth={1.5} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{p.title}</span>
                <span className="mt-[3px] block text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{p.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

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
