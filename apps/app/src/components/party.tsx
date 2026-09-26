import Link from "next/link";
import type { ReactNode } from "react";
import { Card, cx } from "./ui";

/**
 * The reference's "Send to" card: an 18px label with a hairline rule running
 * to the edge, then the party row. Checkout uses it for "Pay to".
 */
export function PartyCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("px-[16.5px] pt-[16.5px] pb-[14.5px]", className)}>
      <div className="flex h-6 items-center gap-[10px]">
        <h2 className="text-[18px] font-medium tracking-[-0.04em]">{label}</h2>
        <span aria-hidden className="h-px flex-1 bg-divider" />
      </div>
      <div className="mt-[16.5px]">{children}</div>
    </Card>
  );
}

/** Avatar, a name and a meta line centred on it, and one action on the right. */
export function PartyRow({
  avatar,
  name,
  meta,
  action,
}: {
  avatar: ReactNode;
  name: ReactNode;
  meta: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-[14.5px]">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{name}</p>
        <p className="mt-[3px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{meta}</p>
      </div>
      {action}
    </div>
  );
}

/** The grey "Change" pill on the Send to and From cards. */
export function ChangePill({ onClick, href, label }: { onClick?: () => void; href?: string; label: string }) {
  const cls =
    "press mr-1 inline-flex h-[34px] shrink-0 items-center rounded-full bg-pill-soft px-[10.5px] text-[15px] tracking-[-0.02em] text-fg";
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={label}>
        Change
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={label}>
      Change
    </button>
  );
}
