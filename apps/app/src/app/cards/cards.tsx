"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MainCardPill, PolarisCard } from "@/components/art";
import { Icon } from "@/components/icon";
import { ReceiveSheet } from "@/components/receive-sheet";
import { cx, SCREEN_TOP, Skeleton, stagger } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { getBalance, getCreditLine } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { usd } from "@/lib/money";

/** Select card: the account's three faces, stacked as in the reference. */
export function Cards() {
  const router = useRouter();
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const [addOpen, setAddOpen] = useState(false);

  const cardSkeleton = <Skeleton className="aspect-[372/219] w-full rounded-card" />;

  return (
    <main
      id="main"
      className={cx("flex min-h-dvh flex-col px-[15px] pb-[calc(96px+env(safe-area-inset-bottom))]", SCREEN_TOP)}
    >
      <header className="flex h-[41px] items-center justify-between">
        <h1 className="text-[18px] tracking-[-0.02em]">Select card</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="press inline-flex h-[40.5px] items-center gap-[7px] rounded-full bg-surface pr-[14px] pl-[14px] text-[16px] tracking-[-0.02em] shadow-surface"
        >
          <Icon name="plus" size={17} strokeWidth={1.7} />
          Add money
        </button>
      </header>

      <ul className="mt-[21px] flex flex-col gap-3">
        <li className="rise" style={stagger(0)}>
          <Link href="/" aria-label="Dollar account, your main card" className="press block rounded-card">
            {balance.value ? (
              <PolarisCard
                tone="lime"
                label="Dollar account"
                amount={usd(balance.value.available)}
                last4="2451"
                badge={<MainCardPill />}
              />
            ) : (
              cardSkeleton
            )}
          </Link>
        </li>
        <li className="rise" style={stagger(1)}>
          <Link href="/plans" aria-label="Pay later" className="press block rounded-card">
            {credit.value ? (
              <PolarisCard
                tone="ink"
                label="Pay later"
                amount={usd(credit.value.available, { trim: true })}
                suffix="available"
                last4="0095"
              />
            ) : (
              cardSkeleton
            )}
          </Link>
        </li>
        <li className="rise" style={stagger(2)}>
          <div aria-label="Boost: dollars you lock to raise your limit" role="group">
            <PolarisCard
              tone="white"
              label="Boost"
              amount="$0"
              suffix="locked"
              last4="1122"
              className="shadow-surface"
            />
          </div>
        </li>
      </ul>

      <div className="column-fixed pointer-events-none bottom-0 z-40 flex justify-center pb-[calc(21px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="press pointer-events-auto inline-flex h-[52px] items-center gap-[3px] rounded-full bg-chip pr-[25.5px] pl-[22px] text-[16px] tracking-[-0.02em] text-on-chip shadow-float"
        >
          <Icon name="close" size={22} strokeWidth={1.5} />
          Close
        </button>
      </div>

      <ReceiveSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </main>
  );
}
