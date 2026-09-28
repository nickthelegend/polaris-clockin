"use client";

import { DEV_SIGNER } from "@/lib/account";
import { DEMO_MODE } from "@/lib/api";

/**
 * The two labels that say this build is not the real thing, always on
 * screen: the dev signer standing in for Face ID, and the offline demo (no
 * Polaris API: sample data, and a stub relayer whose "transactions" never
 * reach a chain, so no receipt links to an explorer).
 */
export function BuildBadges() {
  if (!DEV_SIGNER && !DEMO_MODE) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4px+env(safe-area-inset-top))] z-[1000] flex justify-center gap-1.5">
      {DEV_SIGNER ? (
        <p
          role="note"
          className="flex h-[18px] items-center gap-1.5 rounded-full bg-ui-warn px-2 font-satoshi text-[10px] leading-none font-bold tracking-[0.02em] text-[#0f1011]"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-[#0f1011]" />
          Dev signer · not Face ID
        </p>
      ) : null}
      {DEMO_MODE ? (
        <p
          role="note"
          className="flex h-[18px] items-center gap-1.5 rounded-full bg-ui-surface-2 px-2 font-satoshi text-[10px] leading-none font-bold tracking-[0.02em] text-ui-text"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-ui-warn" />
          Demo mode · sample data, nothing is on chain
        </p>
      ) : null}
    </div>
  );
}
