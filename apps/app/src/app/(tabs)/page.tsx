"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityList } from "@/components/activity-list";
import { Coin, MiniCard } from "@/components/art";
import { Avatar } from "@/components/avatar";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { BalanceFigure, LocalEquivalent } from "@/components/money";
import { ReceiveSheet } from "@/components/receive-sheet";
import { TabBarSpacer } from "@/components/tab-bar";
import { Card, CardTitle, ChipLink, Skeleton, Wordmark } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { getActivity, getBalance, getContacts, getCreditLine } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { relativeDay } from "@/lib/dates";
import { usd } from "@/lib/money";

export default function HomePage() {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const contacts = useData(() => getContacts(owner), [owner]);
  const activity = useData(() => getActivity(owner), [owner]);
  const [receiveOpen, setReceiveOpen] = useState(false);

  return (
    <main id="main" className="px-[15px] pt-[max(44px,calc(env(safe-area-inset-top)+12px))]">
      <header className="flex h-[41px] items-center justify-between">
        <h1>
          <Wordmark />
        </h1>
        <div className="flex items-center gap-2.5">
          <HelpButton />
          <ChipLink href="/plans" icon="plans" sparkle>
            Pay later
          </ChipLink>
        </div>
      </header>

      {account.status === "none" ? (
        <Link
          href="/onboard?next=/"
          className="press mt-4 flex items-center gap-3 rounded-card bg-surface p-3.5 pr-4"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime text-on-lime">
            <Icon name="faceId" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">This is a sample account</span>
            <span className="block text-[13px] text-muted">Create yours with Face ID. It takes a second.</span>
          </span>
          <Icon name="chevronRight" size={20} className="text-muted" />
        </Link>
      ) : null}

      {/* Balance */}
      <section aria-labelledby="balance-label" className="relative -mx-4 mt-5 px-4 pt-3 pb-5 text-center">
        <div aria-hidden className="balance-grid absolute inset-0 -z-10" />
        <Link
          href="/cards"
          id="balance-label"
          className="press mx-auto inline-flex h-8 items-center gap-2 rounded-full px-2 text-[15px] text-muted"
        >
          Your dollar balance
          <MiniCard className="h-[14px] w-[22px]" />
          <Icon name="chevronDown" size={16} />
          <span className="sr-only">, see your cards</span>
        </Link>
        <p className="mt-2 text-[46px] leading-none">
          {balance.value ? <BalanceFigure amount={balance.value.available} /> : <Skeleton className="mx-auto h-[46px] w-56" />}
        </p>
        <p className="mt-2 h-5 text-[15px]">
          {balance.value ? <LocalEquivalent amount={balance.value.available} /> : null}
        </p>
        <Link
          href="/plans"
          className="press mt-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-pill px-3.5 text-[14px] text-muted"
        >
          Credit available
          <span className="tabular font-medium text-fg">{credit.value ? usd(credit.value.available) : "…"}</span>
        </Link>
      </section>

      {/* Send / Receive */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/send"
          className="press flex h-14 items-center justify-center gap-2 rounded-btn bg-surface text-[16px] font-medium"
        >
          <Icon name="send" size={20} />
          Send
        </Link>
        <button
          type="button"
          onClick={() => setReceiveOpen(true)}
          className="press flex h-14 items-center justify-center gap-2 rounded-btn bg-surface text-[16px] font-medium"
        >
          <Icon name="receive" size={20} />
          Receive
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {/* Promo */}
        <Link
          href="/send"
          className="press relative flex items-center gap-3 overflow-hidden rounded-card bg-promo p-4 pr-3 text-white ring-1 ring-white/5"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium tracking-[-0.01em]">Send dollars abroad, fee free</span>
            <span className="mt-1 block text-[14px] leading-snug text-white/70">
              Pay anyone in 150+ countries with a link. It lands in under a second.
            </span>
          </span>
          <Coin size={78} className="shrink-0 drop-shadow-[0_6px_10px_rgb(0_0_0/0.45)]" />
        </Link>

        {/* Credit line */}
        <Card className="p-4">
          <CardTitle
            action={
              <Link href="/plans" className="text-[14px] text-muted hover:text-fg">
                Plans
              </Link>
            }
          >
            Pay later
          </CardTitle>
          {credit.value ? (
            <>
              <p className="tabular mt-2 font-display text-[26px] font-medium tracking-[-0.03em]">
                {usd(credit.value.available)}
                <span className="ml-1.5 font-sans text-[15px] font-normal tracking-normal text-muted">
                  available of {usd(credit.value.limit, { trim: true })}
                </span>
              </p>
              <div
                className="mt-3 flex h-2 overflow-hidden rounded-full bg-pill"
                role="img"
                aria-label={`${usd(credit.value.used)} of ${usd(credit.value.limit, { trim: true })} in use`}
              >
                <span
                  className="h-full rounded-full bg-lime"
                  style={{
                    width: `${credit.value.limit > 0n ? Number((credit.value.available * 1000n) / credit.value.limit) / 10 : 0}%`,
                  }}
                />
              </div>
              {credit.value.nextPayment ? (
                <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
                  <Icon name="clock" size={16} />
                  Next payment
                  <span className="tabular font-medium text-fg">{usd(credit.value.nextPayment.amount)}</span>
                  {relativeDay(credit.value.nextPayment.dueAt)} · {credit.value.nextPayment.merchant}
                </p>
              ) : (
                <p className="mt-3 text-[14px] text-muted">Nothing due. Split your next purchase into four at checkout.</p>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-4 w-56" />
            </div>
          )}
        </Card>

        {/* Send again */}
        <Card className="p-4 pb-3">
          <CardTitle
            action={
              <Link
                href="/send"
                className="press inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 text-[14px] ring-1 ring-hairline ring-inset"
              >
                <Icon name="plus" size={16} />
                Add
              </Link>
            }
          >
            Send again
          </CardTitle>
          <ul className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
            {contacts.value
              ? contacts.value.map((person) => (
                  <li key={person.id}>
                    <Link
                      href={`/send?contact=${person.id}`}
                      className="press flex w-[68px] flex-col items-center gap-1.5 rounded-2xl py-1"
                    >
                      <Avatar name={person.name} country={person.country} size={52} />
                      <span className="w-full truncate text-center text-[13px]">
                        {person.name.split(" ")[0]} {person.name.split(" ")[1]?.[0]}
                      </span>
                    </Link>
                  </li>
                ))
              : Array.from({ length: 5 }, (_, i) => (
                  <li key={i} className="flex w-[68px] flex-col items-center gap-1.5 py-1">
                    <Skeleton className="size-[52px] rounded-full" />
                    <Skeleton className="h-3 w-10" />
                  </li>
                ))}
          </ul>
        </Card>

        {/* History */}
        <Card className="p-4 pb-2">
          <CardTitle
            action={
              <Link href="/activity" className="text-[14px] text-muted hover:text-fg">
                See all
              </Link>
            }
          >
            History
          </CardTitle>
          <div className="mt-2">
            {activity.value ? (
              <ActivityList items={activity.value.slice(0, 4)} />
            ) : (
              <div className="space-y-3 py-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-12 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <TabBarSpacer />
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} />
    </main>
  );
}
