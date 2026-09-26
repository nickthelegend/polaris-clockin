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
import { Button, Card, cx, Skeleton, stagger } from "@/components/ui";
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
      <div className="rise mt-5" style={stagger(0)}>
        {credit.value ? (
          <PolarisCard
            tone="ink"
            label="Pay later"
            amount={`${usd(credit.value.available)} available`}
            last4="0095"
            compact
            badge={
              <span className="tabular inline-flex h-8 items-center rounded-full bg-white/12 px-3 text-[14px] font-medium text-white">
                of {usd(credit.value.limit, { trim: true })}
              </span>
            }
          />
        ) : (
          <Skeleton className="aspect-[372/200] w-full rounded-card" />
        )}
      </div>
      {credit.value?.nextPayment ? (
        <p className="mt-3 flex items-center gap-2 px-1 text-[14px] text-muted">
          <Icon name="clock" size={16} />
          Next payment <span className="tabular font-medium text-fg">{usd(credit.value.nextPayment.amount)}</span>
          {relativeDay(credit.value.nextPayment.dueAt)} to {credit.value.nextPayment.merchant}
        </p>
      ) : null}

      {/* Pay in 4 */}
      <section aria-labelledby="plans-h" className="mt-7">
        <h2 id="plans-h" className="mb-3 px-1 text-[17px] font-medium tracking-[-0.01em]">
          Pay in 4
        </h2>
        {plans.value === undefined ? (
          <Skeleton className="h-40 w-full rounded-card" />
        ) : active.length === 0 ? (
          <Empty
            icon="plans"
            title="No plans open"
            body="Choose Pay in 4 at checkout. Every payment and the total interest are shown before you confirm."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((plan, i) => (
              <li key={plan.id} className="rise" style={stagger(i + 1)}>
                <PlanCard plan={plan} onPayEarly={() => setPayingEarly(plan)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Subscriptions */}
      <section aria-labelledby="subs-h" className="mt-7">
        <h2 id="subs-h" className="mb-3 px-1 text-[17px] font-medium tracking-[-0.01em]">
          Subscriptions
        </h2>
        {plans.value === undefined ? (
          <Skeleton className="h-24 w-full rounded-card" />
        ) : subs.length === 0 ? (
          <Empty icon="repeat" title="No subscriptions" body="Subscribe from a merchant's link. You can cancel here any time, with Face ID." />
        ) : (
          <Card className="divide-y divide-divider px-4">
            {subs.map((sub) => (
              <div key={sub.id} className="flex items-center gap-3 py-3.5">
                <Avatar name={sub.merchant.name} kind="merchant" size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-medium">{sub.merchant.name}</p>
                  <p className="text-[13px] text-muted">
                    {sub.status === "active"
                      ? `${usd(sub.price)} ${describeInterval(sub.periodSeconds)} · next ${shortDate(sub.nextChargeAt)}`
                      : `${sub.name} · nothing more will be charged`}
                  </p>
                </div>
                {sub.status === "active" ? (
                  <Button variant="quiet" size="sm" onClick={() => setCancelling(sub)}>
                    Cancel
                  </Button>
                ) : (
                  <span className="rounded-full bg-pill px-3 py-1 text-[13px] text-muted">Cancelled</span>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      {done.length > 0 ? (
        <section aria-labelledby="done-h" className="mt-7">
          <h2 id="done-h" className="mb-3 px-1 text-[17px] font-medium tracking-[-0.01em]">
            Paid off
          </h2>
          <Card className="divide-y divide-divider px-4">
            {done.map((plan) => (
              <div key={plan.id} className="flex items-center gap-3 py-3.5">
                <Avatar name={plan.merchant.name} kind="merchant" size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-medium">{plan.merchant.name}</p>
                  <p className="truncate text-[13px] text-muted">{plan.description}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[14px] font-medium text-positive">
                  <Icon name="check" size={16} strokeWidth={2.4} />
                  {usd(plan.principal + plan.interest, { trim: true })}
                </span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <TabBarSpacer />

      <PayEarlySheet plan={payingEarly} onClose={() => setPayingEarly(null)} />
      <CancelSheet sub={cancelling} onClose={() => setCancelling(null)} />
    </main>
  );
}

function Empty({ icon, title, body }: { icon: "plans" | "repeat"; title: string; body: string }) {
  return (
    <Card className="p-5 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-pill">
        <Icon name={icon} size={20} />
      </span>
      <p className="mt-3 text-[16px] font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-[32ch] text-[14px] text-muted">{body}</p>
    </Card>
  );
}

function PlanCard({ plan, onPayEarly }: { plan: Plan; onPayEarly: () => void }) {
  const paid = plan.instalments.filter((i) => i.paidAt !== null).length;
  const left = plan.instalments.filter((i) => i.paidAt === null).reduce((sum, i) => sum + i.amount, 0n);
  const next = plan.instalments.find((i) => i.paidAt === null);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar name={plan.merchant.name} kind="merchant" size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-medium">{plan.merchant.name}</p>
          <p className="truncate text-[13px] text-muted">{plan.description}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-[16px] font-medium">{usd(left)}</p>
          <p className="text-[13px] text-muted">left</p>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-4 gap-2" aria-label={`${paid} of ${plan.instalments.length} paid`}>
        {plan.instalments.map((inst) => {
          const isNext = inst === next;
          return (
            <li key={inst.index} className="flex flex-col gap-1.5">
              <span
                aria-hidden
                className={cx(
                  "h-1.5 rounded-full",
                  inst.paidAt !== null ? "bg-lime" : isNext ? "bg-fg/70" : "bg-pill",
                )}
              />
              <span className={cx("text-[12px]", isNext ? "font-medium text-fg" : "text-muted")}>
                {inst.paidAt !== null ? "Paid" : shortDate(inst.dueAt)}
              </span>
              <span className="tabular text-[13px] font-medium">{usd(inst.amount)}</span>
              <span className="sr-only">{inst.paidAt !== null ? "paid" : isNext ? "next" : "due"}</span>
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-divider pt-3">
          <p className="text-[14px] text-muted">
            Next <span className="tabular font-medium text-fg">{usd(next.amount)}</span> {relativeDay(next.dueAt)}
          </p>
          <Button size="sm" variant="quiet" onClick={onPayEarly}>
            Pay early
          </Button>
        </div>
      ) : null}
    </Card>
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
      <p className="mt-3 text-center text-[13px] text-muted">
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
