"use client";

import { useState } from "react";
import { usd } from "@/lib/money";
import type { CreditLine } from "@/lib/data";
import { bringHistory } from "@/lib/underwriting";
import { Icon, type IconName } from "./icon";
import { Sheet } from "./sheet";
import { Button } from "./ui";

const LOOKS_AT: Array<{ icon: IconName; text: string }> = [
  { icon: "clock", text: "How long the wallet has been in use" },
  { icon: "globe", text: "Where its money came from" },
  { icon: "shield", text: "How long it has held dollars" },
];

/**
 * "Raise your limit": the one optional step that may say "wallet", because
 * it exists for people who already have one (plan §2, §5.5).
 */
export function BringHistorySheet({
  open,
  onClose,
  credit,
}: {
  open: boolean;
  onClose: () => void;
  credit: CreditLine | undefined;
}) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        if (state === "done") setState("idle");
      }}
      title={state === "done" ? "Your limit went up" : "Raise your limit"}
      description={
        state === "done"
          ? undefined
          : "Confirm with the wallet you already use. We read its history to raise your limit. Nothing moves from it."
      }
    >
      {state === "done" && credit ? (
        <div>
          <p className="tabular font-display text-[40px] font-bold tracking-[-0.045em]">{usd(credit.limit, { trim: true })}</p>
          <p className="text-[15px] text-muted">is your Pay later limit now.</p>
          <ul className="mt-4 flex flex-col gap-2">
            {credit.reasons.slice(-3).map((r) => (
              <li key={r.label} className="flex justify-between text-[15px]">
                <span>{r.label}</span>
                <span className="tabular text-positive">+{r.points}</span>
              </li>
            ))}
          </ul>
          <Button block className="mt-6" onClick={onClose}>
            Back to checkout
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-[14px] font-medium text-muted">What we look at</p>
          <ul className="mt-3 flex flex-col gap-3">
            {LOOKS_AT.map((l) => (
              <li key={l.text} className="flex items-center gap-3 text-[15px]">
                <span className="grid size-9 place-items-center rounded-full bg-pill">
                  <Icon name={l.icon} size={18} />
                </span>
                {l.text}
              </li>
            ))}
          </ul>
          {credit ? (
            <p className="mt-4 text-[14px] text-muted">
              New limits start at $200 and go up to {usd(credit.openingCap, { trim: true })}. Paying on time raises them from there.
            </p>
          ) : null}
          <Button
            block
            icon="wallet"
            className="mt-6"
            busy={state === "working"}
            disabled={credit?.historyLinked}
            onClick={async () => {
              setState("working");
              try {
                await bringHistory();
                setState("done");
              } catch {
                setState("idle");
              }
            }}
          >
            {state === "working"
              ? "Reading your history…"
              : credit?.historyLinked
                ? "History already linked"
                : "Connect your wallet"}
          </Button>
          <p className="mt-3 text-center text-[13px] text-muted">Your wallet only confirms it&apos;s yours. Nothing moves from it.</p>
        </div>
      )}
    </Sheet>
  );
}
