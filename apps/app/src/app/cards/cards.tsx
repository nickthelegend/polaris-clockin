"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PolarisCard } from "@/components/art";
import { Icon } from "@/components/icon";
import { ReceiveSheet } from "@/components/receive-sheet";
import { cx, Skeleton, stagger } from "@/components/ui";
import { useAccountState } from "@/lib/account/hooks";
import { getBalance, getCreditLine } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { usd } from "@/lib/money";

/** Select card: the account's three faces, stacked like the reference. */
export function Cards() {
  const router = useRouter();
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const [addOpen, setAddOpen] = useState(false);

  const mainPill = (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-chip pr-3.5 pl-2 text-[15px] font-medium text-on-chip">
      <span className="grid size-5 place-items-center rounded-full bg-white text-black">
        <Icon name="check" size={13} strokeWidth={3} />
      </span>
      Main card
    </span>
  );

  return (
    <main id="main" className="flex min-h-dvh flex-col px-4 pt-[calc(env(safe-area-inset-top)+14px)] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <header className="flex h-12 items-center justify-between">
        <h1 className="text-[19px] font-medium tracking-[-0.01em]">Select card</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[15px] ring-1 ring-hairline ring-inset"
        >
          <Icon name="plus" size={18} />
          Add money
        </button>
      </header>

      <ul className="mt-4 flex flex-col gap-3">
        <li className="rise" style={stagger(0)}>
          <Link href="/" aria-label="Dollar account, your main card" className="press block -translate-y-1 rounded-card">
            {balance.value ? (
              <PolarisCard tone="lime" label="Dollar account" amount={usd(balance.value.available)} last4="2451" badge={mainPill} />
            ) : (
              <Skeleton className="aspect-[372/218] w-full rounded-card" />
            )}
          </Link>
        </li>
        <li className="rise" style={stagger(1)}>
          <Link href="/plans" aria-label="Pay later card" className="press block rounded-card">
            {credit.value ? (
              <PolarisCard tone="ink" label="Pay later" amount={`${usd(credit.value.available)} available`} last4="0095" />
            ) : (
              <Skeleton className="aspect-[372/218] w-full rounded-card" />
            )}
          </Link>
        </li>
        <li className={cx("rise")} style={stagger(2)}>
          <PolarisCard
            tone="white"
            label="Boost"
            amount="$0 locked"
            last4="1122"
            badge={<span className="max-w-[18ch] text-right text-[13px] text-black/60">Lock dollars to raise your limit</span>}
          />
        </li>
      </ul>

      <div className="mt-auto flex justify-center pt-8">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="press inline-flex h-14 items-center gap-2 rounded-full bg-chip px-7 text-[16px] font-medium text-on-chip shadow-float"
        >
          <Icon name="close" size={20} />
          Close
        </button>
      </div>

      <ReceiveSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </main>
  );
}
