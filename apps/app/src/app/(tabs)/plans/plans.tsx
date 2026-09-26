"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PolarisCard } from "@/components/art";
import { Avatar } from "@/components/avatar";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { Sheet } from "@/components/sheet";
import { TabBarSpacer } from "@/components/tab-bar";
import { TabHeader } from "@/components/tab-header";
import { Button, Card, CardTitle, cx, Skeleton, stagger } from "@/components/ui";
import { cancelSubscription, payEarly } from "@/lib/actions";
import { useAccountState } from "@/lib/account/hooks";
import { describeInterval, getCreditLine, getPlans, type Plan, type Subscription } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { relativeDay, shortDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { usd } from "@/lib/money";

export function Plans() {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const plans = useData(() => getPlans(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const [payingEarly, setPayingEarly] = useState<Plan | null>(null);
  const [cancelling, setCancelling] = useState<Subscription | null>(null);

  useEffect(() => prefetchDomains("payments"), []);

  const active = plans.value?.plans.filter((p) => p.status === "active") ?? [];
  const done = plans.value?.plans.filter((p) => p.status === "completed") ?? [];
  const subs = plans.value?.subscriptions ?? [];

  return (
    <main id="main" className="px-[15px]">
      <TabHeader title="Plans" right={<HelpButton />} />

      {/* The credit line, as the black card */}
      <div className="rise mt-[21px]" style={stagger(0)}>
        {credit.value ? (
          <Link href="/cards" aria-label="Pay later card" className="press block rounded-card">
            <PolarisCard
              tone="ink"
              label="Pay later"
              amount={usd(credit.value.available, { trim: true })}
              suffix="available"
              last4="0095"
              badge={
                <span className="inline-flex h-[36.5px] items-center rounded-full bg-white/12 px-[14px] text-[16px] tracking-[-0.02em] text-white">
                  of {usd(credit.value.limit, { trim: true })}
                </span>
              }
            />
          </Link>
        ) : (
          <Skeleton className="aspect-[372/219] w-full rounded-card" />
        )}
      </div>
      <p className="mt-3 flex h-5 items-center gap-1.5 px-[2px] text-[14px] tracking-[-0.02em] text-meta">
        {credit.value?.nextPayment ? (
          <>
            <Icon name="clock" size={16} />
            Next payment <span className="font-medium text-fg">{usd(credit.value.nextPayment.amount)}</span>
            {relativeDay(credit.value.nextPayment.dueAt)} to {credit.value.nextPayment.merchant}
          </>
        ) : credit.value ? (
          "Nothing due. Split your next purchase into four at checkout."
        ) : null}
      </p>

      {/* Pay in 4 */}
      <Card className="rise mt-[13.5px] px-4 pt-4 pb-2" style={stagger(1)} aria-labelledby="plans-h">
        <CardTitle>
          <span id="plans-h">Pay in 4</span>
        </CardTitle>
        {plans.value === undefined ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : active.length === 0 ? (
          <Empty
            icon="calendar"
            title="No plans open"
            body="Choose Pay in 4 at checkout. Every payment and the total interest are shown first."
          />
        ) : (
          <ul className="mt-[7.25px] divide-y divide-divider">
            {active.map((plan) => (
              <li key={plan.id}>
                <PlanBlock plan={plan} onPayEarly={() => setPayingEarly(plan)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Subscriptions */}
      <Card className="rise mt-[13.5px] px-4 pt-4 pb-2" style={stagger(2)} aria-labelledby="subs-h">
        <CardTitle>
          <span id="subs-h">Subscriptions</span>
        </CardTitle>
        {plans.value === undefined ? (
          <div className="py-4">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : subs.length === 0 ? (
          <Empty icon="repeat" title="No subscriptions" body="Subscribe from a merchant's link. Cancel here any time, with Face ID." />
        ) : (
          <ul className="mt-[7.25px]">
            {subs.map((sub) => (
              <li key={sub.id} className="flex h-[70.5px] items-center gap-[14.5px]">
                <Avatar name={sub.merchant.name} kind="merchant" icon="repeat" size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{sub.merchant.name}</p>
                  <p className="mt-[3px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">
                    {sub.status === "active"
                      ? `${usd(sub.price)} ${describeInterval(sub.periodSeconds)} · next ${shortDate(sub.nextChargeAt)}`
                      : `${sub.name} · nothing more will be charged`}
                  </p>
                </div>
                {sub.status === "active" ? (
                  <Button variant="quiet" size="sm" className="px-[10.5px]" onClick={() => setCancelling(sub)}>
                    Cancel
                  </Button>
                ) : (
                  <span className="inline-flex h-[34px] items-center rounded-full bg-pill-faint px-[10.5px] text-[15px] tracking-[-0.02em] text-muted">
                    Cancelled
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 ? (
        <Card className="rise mt-[13.5px] px-4 pt-4 pb-2" style={stagger(3)} aria-labelledby="done-h">
          <CardTitle>
            <span id="done-h">Paid off</span>
          </CardTitle>
          <ul className="mt-[7.25px]">
            {done.map((plan) => (
              <li key={plan.id} className="flex h-[70.5px] items-center gap-[14.5px]">
                <Avatar name={plan.merchant.name} kind="merchant" icon="check" size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{plan.merchant.name}</p>
                  <p className="mt-[3px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{plan.description}</p>
                </div>
                <span className="text-[16px] font-medium tracking-[-0.03em] text-positive">
                  {usd(plan.principal + plan.interest, { trim: true })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TabBarSpacer />

      <PayEarlySheet plan={payingEarly} onClose={() => setPayingEarly(null)} />
      <CancelSheet sub={cancelling} onClose={() => setCancelling(null)} />
    </main>
  );
}

function Empty({ icon, title, body }: { icon: "calendar" | "repeat"; title: string; body: string }) {
  return (
    <div className="py-5 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-well text-[#77797c]">
        <Icon name={icon} size={26} strokeWidth={1.5} />
      </span>
      <p className="mt-3 text-[16px] font-medium tracking-[-0.03em]">{title}</p>
      <p className="mx-auto mt-1 max-w-[32ch] text-[14px] tracking-[-0.02em] text-meta">{body}</p>
    </div>
  );
}

/** One plan: the merchant row, four ticks (lime paid, ink next, grey due) and Pay early. */
function PlanBlock({ plan, onPayEarly }: { plan: Plan; onPayEarly: () => void }) {
  const paid = plan.instalments.filter((i) => i.paidAt !== null).length;
  const left = plan.instalments.filter((i) => i.paidAt === null).reduce((sum, i) => sum + i.amount, 0n);
  const next = plan.instalments.find((i) => i.paidAt === null);
  return (
    <div className="pb-4">
      <div className="flex h-[70.5px] items-center gap-[14.5px]">
        <Avatar name={plan.merchant.name} kind="merchant" icon="calendar" size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{plan.merchant.name}</p>
          <p className="mt-[3px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{plan.description}</p>
        </div>
        <div className="text-right">
          <p className="text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{usd(left)}</p>
          <p className="mt-[3px] text-[14px] leading-[18px] tracking-[-0.02em] text-meta">left</p>
        </div>
      </div>

      <ol className="mt-1.5 grid grid-cols-4 gap-2" aria-label={`${paid} of ${plan.instalments.length} paid`}>
        {plan.instalments.map((inst) => {
          const isNext = inst === next;
          return (
            <li key={inst.index} className="flex flex-col gap-1.5">
              <span
                aria-hidden
                className={cx("h-[5px] rounded-full", inst.paidAt !== null ? "bg-lime" : isNext ? "bg-fg" : "bg-pill")}
              />
              <span className={cx("text-[13px] tracking-[-0.01em]", isNext ? "font-medium text-fg" : "text-muted")}>
                {inst.paidAt !== null ? "Paid" : shortDate(inst.dueAt)}
              </span>
              <span className="text-[14px] font-medium tracking-[-0.02em]">{usd(inst.amount)}</span>
              <span className="sr-only">{inst.paidAt !== null ? "paid" : isNext ? "next" : "due"}</span>
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <p className="text-[14px] tracking-[-0.02em] text-meta">
            Next <span className="font-medium text-fg">{usd(next.amount)}</span> {relativeDay(next.dueAt)}
          </p>
          <Button size="sm" variant="quiet" className="px-[10.5px]" onClick={onPayEarly}>
            Pay early
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PayEarlySheet({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const next = plan?.instalments.find((i) => i.paidAt === null);
  return (
    <Sheet
      open={plan !== null}
      onClose={onClose}
      title={next ? `Pay ${usd(next.amount)} now?` : "Pay early"}
      description={
        plan && next
          ? `Your next payment to ${plan.merchant.name}, due ${shortDate(next.dueAt)}. Paying early costs nothing extra.`
          : undefined
      }
    >
      {plan && next ? (
        <FaceIdAction
          label={`Pay ${usd(next.amount)} with Face ID`}
          busyLabel="Paying…"
          onAccount={async (signer) => {
            await payEarly(signer, plan);
            onClose();
          }}
        />
      ) : null}
      <p className="mt-3 text-center text-[14px] tracking-[-0.02em] text-muted">
        <Link href="/activity" className="underline underline-offset-4">
          See past payments
        </Link>
      </p>
    </Sheet>
  );
}

function CancelSheet({ sub, onClose }: { sub: Subscription | null; onClose: () => void }) {
  return (
    <Sheet
      open={sub !== null}
      onClose={onClose}
      title={sub ? `Cancel ${sub.merchant.name}?` : "Cancel subscription"}
      description={sub ? `${sub.name}, ${usd(sub.price)} ${describeInterval(sub.periodSeconds)}. Nothing more will be charged.` : undefined}
    >
      {sub ? (
        <div className="flex flex-col gap-2">
          <FaceIdAction
            variant="danger"
            label="Cancel subscription"
            busyLabel="Cancelling…"
            onAccount={async (signer) => {
              await cancelSubscription(signer, sub.subId);
              onClose();
            }}
          />
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
