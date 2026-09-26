"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityList } from "@/components/activity-list";
import { CardChip, Coin } from "@/components/art";
import { Avatar } from "@/components/avatar";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { BalanceFigure, LocalEquivalent } from "@/components/money";
import { ReceiveSheet } from "@/components/receive-sheet";
import { TabBarSpacer } from "@/components/tab-bar";
import { Card, CardTitle, ChipLink, MoreLink, SCREEN_TOP, Skeleton, SoftPill, Wordmark, cx } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { getActivity, getBalance, getContacts, getCreditLine } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { usd } from "@/lib/money";

/** Home, laid out on the reference's home screen. */
export default function HomePage() {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const contacts = useData(() => getContacts(owner), [owner]);
  const activity = useData(() => getActivity(owner), [owner]);
  const [receiveOpen, setReceiveOpen] = useState(false);

  return (
    <main id="main" className={cx("relative px-[15px]", SCREEN_TOP)}>
      {/* The faint grid behind the header and balance, fading out around it. */}
      <div aria-hidden className="balance-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px]" />

      <header className="flex h-[41px] items-center justify-between">
        <h1>
          <Wordmark />
        </h1>
        <div className="flex items-center gap-[9.5px]">
          <HelpButton />
          <ChipLink href="/plans" icon="calendar" sparkle>
            Pay later
          </ChipLink>
        </div>
      </header>

      {/* Balance */}
      <section aria-labelledby="balance-label" className="mt-8 text-center">
        <Link
          href="/cards"
          id="balance-label"
          className="press mx-auto inline-flex h-6 items-center text-[16px] tracking-[-0.025em] text-muted"
        >
          Your dollar balance
          <CardChip className="ml-[6px]" />
          <Icon name="chevronDown" size={14} strokeWidth={2} className="ml-[8px]" />
          <span className="sr-only">, see your cards</span>
        </Link>
        <p className="mt-3 h-[46px] text-[46px] leading-none">
          {balance.value ? (
            <BalanceFigure amount={balance.value.available} />
          ) : (
            <Skeleton className="mx-auto h-[46px] w-56" />
          )}
        </p>
        {balance.value ? <LocalEquivalent amount={balance.value.available} className="mt-1 block text-[14px]" /> : null}
        <Link
          href="/plans"
          className="press mt-[10.5px] inline-flex h-9 items-center gap-[5px] rounded-full bg-pill px-4 text-[14px] tracking-[-0.03em] text-muted"
        >
          Credit available
          <span className="tabular font-medium text-fg">
            {credit.value ? usd(credit.value.available, { trim: true }) : "…"}
          </span>
        </Link>
      </section>

      {/* Send / Receive */}
      <div className="mt-[27.5px] grid grid-cols-2 gap-[8.5px]">
        <Link
          href="/send"
          className="press flex h-[55px] items-center justify-center gap-[9px] rounded-full bg-surface text-[16px] tracking-[-0.02em] shadow-surface"
        >
          <Icon name="send" size={20} strokeWidth={1.6} />
          Send
        </Link>
        <button
          type="button"
          onClick={() => setReceiveOpen(true)}
          className="press flex h-[55px] items-center justify-center gap-[9px] rounded-full bg-surface text-[16px] tracking-[-0.02em] shadow-surface"
        >
          <Icon name="receive" size={20} strokeWidth={1.6} />
          Receive
        </button>
      </div>

      {/* Promo */}
      <Link
        href="/send"
        className="press relative mt-[22px] flex min-h-[94.5px] items-center overflow-hidden rounded-card bg-promo py-[13px] pr-[14px] pl-[16.5px] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.75)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] leading-5 font-medium tracking-[-0.03em] whitespace-nowrap">
            Send dollars abroad, fee free
          </span>
          <span className="mt-1 block max-w-[236px] text-[13px] leading-[19px] tracking-[-0.015em] text-[#a6a6a6]">
            Pay anyone in 150+ countries with a link. It lands in under a second.
          </span>
        </span>
        <Coin size={68} className="shrink-0" />
      </Link>

      {/* Send again */}
      <Card className="mt-[13.5px] overflow-hidden pt-4 pb-[16.5px]">
        <div className="px-4">
          <CardTitle
            action={
              <SoftPill href="/send">
                <Icon name="plus" size={15} strokeWidth={1.8} />
                Add
              </SoftPill>
            }
          >
            Send again
          </CardTitle>
        </div>
        <ul className="mt-[14px] flex gap-[17.25px] overflow-x-auto px-4 [scrollbar-width:none]">
          {contacts.value
            ? contacts.value.map((person) => (
                <li key={person.id} className="shrink-0">
                  <Link href={`/send?contact=${person.id}`} className="press flex w-[57px] flex-col items-center">
                    <Avatar name={person.name} country={person.country} size={57} />
                    <span className="mt-[4.5px] w-[74px] truncate text-center text-[14px] leading-[18px] tracking-[-0.03em]">
                      {person.name.split(" ")[0]} {person.name.split(" ")[1]?.[0]}
                    </span>
                  </Link>
                </li>
              ))
            : Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="flex w-[57px] shrink-0 flex-col items-center gap-[4.5px]">
                  <Skeleton className="size-[57px] rounded-full" />
                  <Skeleton className="h-[18px] w-10" />
                </li>
              ))}
        </ul>
      </Card>

      {/* History */}
      <Card className="mt-[13.5px] px-4 pt-4 pb-2">
        <CardTitle action={<MoreLink href="/activity">see more</MoreLink>}>History</CardTitle>
        <div className="mt-[7.25px]">
          {activity.value ? (
            <ActivityList items={activity.value.slice(0, 4)} />
          ) : (
            <div>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex h-[70.5px] items-center gap-[14.5px]">
                  <Skeleton className="size-14 rounded-full" />
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

      <TabBarSpacer />
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} />
    </main>
  );
}
