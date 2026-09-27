"use client";

import { Logo } from "@polaris/ui";
import { DEV_SIGNER } from "@/lib/account";
import { useHref } from "@/lib/browser";
import { QrCode } from "../qr";

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

/**
 * On a wide desktop screen, the space beside the phone column says what this
 * is and offers the same page on a phone, where Face ID lives.
 */
export function DesktopAside() {
  const href = useHref();
  return (
    <aside
      aria-label="Open on your phone"
      className="fixed top-1/2 left-[max(32px,calc(50%-220px-380px))] hidden w-[300px] -translate-y-1/2 font-satoshi min-[1180px]:block"
    >
      <Logo height={40} />
      <p className="mt-6 text-[40px] leading-[1.02] font-medium tracking-[-0.035em] text-balance">
        Credit, built into the payment.
      </p>
      <p className="mt-4 max-w-[30ch] text-[15px] leading-[1.5] text-ui-muted">
        Pay in full, in four, or every month. Send dollars anywhere with a link. Your account lives behind your Face ID.
      </p>
      {href ? (
        <div className="mt-8 flex items-center gap-4">
          <QrCode value={href} size={96} label="QR code to open this page on your phone" />
          <p className="max-w-[16ch] text-[15px] font-medium">Open this page on your phone</p>
        </div>
      ) : null}
    </aside>
  );
}
