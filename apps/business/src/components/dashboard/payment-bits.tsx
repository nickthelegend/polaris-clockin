"use client";

import { Coin, TableName, type CoinTone, type StatusPillTone } from "@polaris/ui";

import { shortAddress } from "@/lib/data/format";
import type { PayMode, Payment } from "@/lib/data/types";

/** Each mode in ref E's pill colours: lime, purple, teal. */
export const MODE_COLOR: Record<PayMode, string> = {
  now: "var(--ui-lime-button)",
  later: "var(--ui-pill-purple-text)",
  subscribe: "var(--ui-pill-teal-text)",
};

export const MODE_COIN: Record<PayMode, CoinTone> = { now: "lime", later: "purple", subscribe: "teal" };

/** A payment's pill, in ref E's colours: how it was paid, or that it failed. */
export function paymentPill(p: Payment): { tone: StatusPillTone; text: string } {
  if (p.status === "failed") return { tone: "red", text: "Failed" };
  if (p.mode === "later") return { tone: "purple", text: "Pay in 4" };
  if (p.mode === "subscribe") return { tone: "teal", text: "Subscription" };
  return { tone: "lime", text: "Paid" };
}

/** A small round coin in a mode's colour with the item's first letter, like the reference's exchange icons. */
export function ModeCoin({ mode, text, size = 28 }: { mode: PayMode; text: string; size?: number }) {
  return (
    <Coin tone={MODE_COIN[mode]} size={size}>
      <span style={{ fontSize: Math.round(size * 0.47) }}>{text.trim()[0]?.toUpperCase() ?? "·"}</span>
    </Coin>
  );
}

/** The first column: the coin and the buyer, with what they bought under it when there's room. */
export function PaymentName({ p, sub }: { p: Payment; sub?: boolean }) {
  return (
    <TableName
      icon={<ModeCoin mode={p.mode} text={p.description} />}
      title={<span className="ui-figure">{shortAddress(p.buyer, 6, 4)}</span>}
      sub={sub ? p.description : undefined}
    />
  );
}
