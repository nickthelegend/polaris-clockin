"use client";

import {
  AssetRow,
  Button,
  FeaturedTile,
  GradientCard,
  IconButton,
  Money,
  Pill,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Skeleton,
} from "@polaris/ui";
import { Gauge } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MerchantAvatar, merchantBrand } from "@/components/avatars";
import { BringHistorySheet } from "@/components/bring-history";
import { RouteSheet, useCloseSheet } from "@/components/shell/sheet-host";
import { CreditDesktop } from "@/desktop/credit";
import { useOwner } from "@/lib/account/hooks";
import { getCreditLine, getPlans } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { relativeDay, shortDate } from "@/lib/dates";
import { usd } from "@/lib/money";
import { n, planProgress } from "@/lib/view";

/** Credit line (full), on ref B's second screen: the crimson card, active plans, what's coming up. */
export function CreditSheet() {
  const router = useRouter();
  const close = useCloseSheet();
  const owner = useOwner();
  const credit = useData(() => getCreditLine(owner), [owner]);
  const plans = useData(() => getPlans(owner), [owner]);
  const [raising, setRaising] = useState(false);

  const active = plans.value?.plans.filter((p) => p.status === "active") ?? [];
  const upcoming = active
    .flatMap((plan) =>
      plan.instalments
        .filter((i) => i.paidAt === null)
        .map((i) => ({ plan, instalment: i })),
    )
    .sort((a, b) => a.instalment.dueAt - b.instalment.dueAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Credit line"
        onBack={close}
        action={<IconButton label="Credit score" icon={<Gauge />} tone="ghost" onClick={() => router.push("/credit/score", { scroll: false })} />}
        className="-mt-2 shrink-0 px-5"
      />
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-4 pt-1">
        {credit.value ? (
          <GradientCard
            tone="crimson"
            label="Available to spend"
            value={<Money value={n(credit.value.available)} dim="cents" dimOpacity={0.55} />}
            meta={
              <Pill tone="glass" size="md">
                of {usd(credit.value.limit, { trim: true })} · {credit.value.aprBps / 100}% APR
              </Pill>
            }
          />
        ) : (
          <Skeleton shape="card" height={164} />
        )}

        <SectionHeader
          title="Active plans"
          actionLabel="See all"
          onAction={() => router.push("/insights?view=plans")}
          className="mt-2"
        />
        {plans.value ? (
          active.length ? (
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
                    onClick={() => router.push(`/plans/${plan.id}`, { scroll: false })}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-[15px] text-ui-muted">No plans open. Choose Pay in 4 at checkout.</p>
          )
        ) : (
          <div className="flex gap-3">
            <Skeleton shape="tile" width={168} height={176} />
            <Skeleton shape="tile" width={168} height={176} />
          </div>
        )}

        <SectionHeader title="Upcoming" className="mt-2" />
        <div className="flex flex-col gap-2">
          {plans.value
            ? upcoming.slice(0, 6).map(({ plan, instalment }) => (
                <AssetRow
                  key={`${plan.id}-${instalment.index}`}
                  leading={<MerchantAvatar name={plan.merchant.name} />}
                  title={plan.merchant.name}
                  subtitle={`${shortDate(instalment.dueAt)} · ${instalment.index + 1} of ${plan.instalments.length}`}
                  progress={{ done: planProgress(plan).done, total: plan.instalments.length, current: instalment.index }}
                  // Money going out: a neutral meta, not the green of money in.
                  trend="flat"
                  value={usd(instalment.amount)}
                  meta={relativeDay(instalment.dueAt)}
                  onClick={() => router.push(`/plans/${plan.id}`, { scroll: false })}
                />
              ))
            : [0, 1, 2].map((i) => <Skeleton key={i} shape="row" height={72} />)}
          {plans.value && upcoming.length === 0 ? <p className="text-[15px] text-ui-muted">Nothing due.</p> : null}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <Button variant="dark" shape="rounded" size="lg" onClick={() => router.push("/credit/score", { scroll: false })}>
            Credit score
          </Button>
          <Button variant="white" shape="rounded" size="lg" onClick={() => setRaising(true)}>
            Raise limit
          </Button>
        </div>
      </Sheet.Body>
      <BringHistorySheet open={raising} onOpenChange={setRaising} credit={credit.value} />
    </div>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function CreditRoute({ cold }: { cold?: boolean }) {
  return (
    <RouteSheet label="Credit line" snapPoints={["full"]} cold={cold} desktop={{ as: "page", content: <CreditDesktop /> }}>
      <CreditSheet />
    </RouteSheet>
  );
}
