"use client";

import { AssetRow, EmptyState, FeaturedTile, SectionHeader, Skeleton } from "@polaris/ui";
import { CalendarClock, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MerchantAvatar, merchantBrand } from "@/components/avatars";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { cancelSubscription } from "@/lib/actions";
import { useOwner } from "@/lib/account/hooks";
import { describeInterval, getPlans, type Subscription } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { shortDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { usd } from "@/lib/money";
import { planBalanceSeries, planProgress } from "@/lib/view";

/** Plans (Insights → Plans): Pay in 4 as ref B's featured tiles, then subscriptions and what's paid off. */
export function PlansView() {
  const router = useRouter();
  const owner = useOwner();
  const plans = useData(() => getPlans(owner), [owner]);
  const [cancelling, setCancelling] = useState<Subscription | null>(null);

  useEffect(() => prefetchDomains("payments"), []);

  if (!plans.value) {
    return (
      <div className="mt-5 flex flex-col gap-3">
        <div className="flex gap-3">
          <Skeleton shape="tile" width={168} height={176} />
          <Skeleton shape="tile" width={168} height={176} />
        </div>
        <Skeleton shape="row" height={72} />
        <Skeleton shape="row" height={72} />
      </div>
    );
  }

  const active = plans.value.plans.filter((p) => p.status === "active");
  const done = plans.value.plans.filter((p) => p.status === "completed");
  const subs = plans.value.subscriptions;

  return (
    <div className="mt-5 flex flex-col gap-4">
      <SectionHeader title="Pay in 4" />
      {active.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<CalendarClock />}
          title="No plans open"
          description="Choose Pay in 4 at checkout. Every payment and the total interest are shown first."
        />
      ) : (
        <div className="ui-no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5">
          {active.map((plan) => {
            const p = planProgress(plan);
            return (
              <FeaturedTile
                key={plan.id}
                leading={<MerchantAvatar name={plan.merchant.name} size="sm" />}
                title={plan.merchant.name}
                subtitle="Pay in 4"
                value={usd(p.left)}
                meta={p.next ? `Next ${shortDate(p.next.dueAt)}` : "Paid off"}
                progress={{ done: p.done, total: p.total }}
                tint={merchantBrand(plan.merchant.name).color}
                className="w-auto min-w-[168px] grow basis-0"
                aria-label={`${plan.merchant.name}, ${usd(p.left)} left, ${p.done} of ${p.total} paid`}
                onClick={() => router.push(`/plans/${plan.id}`, { scroll: false })}
              />
            );
          })}
        </div>
      )}

      <SectionHeader title="Subscriptions" className="mt-2" />
      {subs.length === 0 ? (
        <EmptyState size="sm" icon={<Repeat />} title="No subscriptions" description="Subscribe from a merchant's link. Cancel here any time." />
      ) : (
        <div className="flex flex-col gap-2">
          {subs.map((sub) => (
            <AssetRow
              key={sub.id}
              leading={<MerchantAvatar name={sub.merchant.name} />}
              title={sub.merchant.name}
              subtitle={sub.status === "active" ? `${sub.name} · next ${shortDate(sub.nextChargeAt)}` : `${sub.name} · cancelled`}
              value={usd(sub.price)}
              meta={sub.status === "active" ? describeInterval(sub.periodSeconds).replace(/^every /, "per ") : "Ended"}
              trend="flat"
              static={sub.status !== "active"}
              onClick={sub.status === "active" ? () => setCancelling(sub) : undefined}
              aria-label={sub.status === "active" ? `${sub.merchant.name}, ${usd(sub.price)} ${describeInterval(sub.periodSeconds)}. Manage` : undefined}
            />
          ))}
        </div>
      )}

      {done.length ? (
        <>
          <SectionHeader title="Paid off" className="mt-2" />
          <div className="flex flex-col gap-2">
            {done.map((plan) => (
              <AssetRow
                key={plan.id}
                leading={<MerchantAvatar name={plan.merchant.name} />}
                title={plan.merchant.name}
                subtitle={plan.description}
                spark={planBalanceSeries(plan)}
                trend="up"
                value={usd(plan.principal + plan.interest)}
                meta="Paid in full"
                onClick={() => router.push(`/plans/${plan.id}`, { scroll: false })}
              />
            ))}
          </div>
        </>
      ) : null}

      <ConfirmSheet
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={cancelling ? `Cancel ${cancelling.merchant.name}?` : "Cancel subscription"}
        summary={
          cancelling
            ? `${cancelling.name}, ${usd(cancelling.price)} ${describeInterval(cancelling.periodSeconds)}. Nothing more will be charged.`
            : ""
        }
        confirmLabel="Cancel with Face ID"
        busyLabel="Cancelling…"
        danger
        onAccount={async (signer) => {
          if (cancelling) await cancelSubscription(signer, cancelling.subId);
        }}
      />
    </div>
  );
}
