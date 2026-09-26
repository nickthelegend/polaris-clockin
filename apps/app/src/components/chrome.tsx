"use client";

import { DEV_SIGNER } from "@/lib/account";
import { useHref } from "@/lib/browser";
import { QrCode } from "./qr";
import { Wordmark } from "./ui";

/** Always on screen while the dev signer stands in for Face ID. */
export function DevSignerBadge() {
  if (!DEV_SIGNER) return null;
  return (
    <div className="column-fixed pointer-events-none top-[calc(10px+env(safe-area-inset-top))] z-50 flex justify-center">
      <p
        role="note"
        className="flex h-5 items-center gap-1.5 rounded-full bg-[#ffb020] px-2 text-[10px] leading-none font-semibold tracking-[0.01em] text-black"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-black" />
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
      className="fixed top-1/2 left-[max(32px,calc(50%-215px-380px))] hidden w-[300px] -translate-y-1/2 min-[1180px]:block"
    >
      <Wordmark className="text-[34px]" />
      <p className="mt-4 font-display text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance">
        Credit, built into the payment.
      </p>
      <p className="mt-4 max-w-[30ch] text-[15px] text-muted">
        Pay in full, in four, or every month. Send dollars anywhere with a link. Your account lives behind your Face ID.
      </p>
      {href ? (
        <div className="mt-8 flex items-center gap-4">
          <QrCode value={href} size={104} label="QR code to open this page on your phone" className="p-2 shadow-float" />
          <p className="max-w-[16ch] text-[14px] font-medium">Open this page on your phone</p>
        </div>
      ) : null}
    </aside>
  );
}
