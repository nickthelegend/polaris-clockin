"use client";

import { DEV_SIGNER } from "@/lib/account";

/** Always on screen while the dev signer stands in for Face ID. */
export function DevSignerBadge() {
  if (!DEV_SIGNER) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4px+env(safe-area-inset-top))] z-[1000] flex justify-center">
      <p
        role="note"
        className="flex h-[18px] items-center gap-1.5 rounded-full bg-ui-warn px-2 font-satoshi text-[10px] leading-none font-bold tracking-[0.02em] text-[#0f1011]"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-[#0f1011]" />
        Dev signer · not Face ID
      </p>
    </div>
  );
}
