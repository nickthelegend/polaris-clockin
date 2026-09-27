"use client";

import { BottomSheet, Button, DetailsList, ListGroup, ListRow, Sheet } from "@polaris/ui";
import { Clock, Globe, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import type { CreditLine } from "@/lib/data";
import { usd } from "@/lib/money";
import { bringHistory } from "@/lib/underwriting";

/**
 * "Raise your limit": the one optional step that may say "wallet", because
 * it exists for people who already have one (plan §2, §5.5).
 */
export function BringHistorySheet({
  open,
  onOpenChange,
  credit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: CreditLine | undefined;
}) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  // Each opening starts fresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setState("idle");
  }

  const done = state === "done" && credit;
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => state !== "working" && onOpenChange(next)}
      dismissible={state !== "working"}
      snapPoints={["half", "full"]}
      title={done ? "Your limit went up" : "Raise your limit"}
      description={done ? undefined : "We read the history of a wallet you already use. Nothing moves from it."}
      maxWidth={440}
    >
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-4 pt-1">
        {done ? (
          <>
            <p className="ui-figure text-[40px] leading-none font-semibold tracking-[-0.035em]">{usd(credit.limit, { trim: true })}</p>
            <p className="-mt-2 text-[15px] text-ui-muted">is your Pay later limit now.</p>
            <DetailsList
              size="sm"
              items={credit.reasons.slice(-3).map((r) => ({ label: r.label, value: <span className="text-ui-up">+{r.points}</span> }))}
            />
          </>
        ) : (
          <>
            <ListGroup label="What we look at">
              <ListRow icon={<Clock />} title="How long it has been in use" />
              <ListRow icon={<Globe />} title="Where its money came from" />
              <ListRow icon={<ShieldCheck />} title="How long it has held dollars" />
            </ListGroup>
            {credit ? (
              <p className="text-[14px] leading-[1.45] text-ui-muted">
                New limits start at $200 and go up to {usd(credit.openingCap, { trim: true })}. Paying on time raises them from there.
              </p>
            ) : null}
          </>
        )}
      </Sheet.Body>
      <Sheet.Footer>
        {done ? (
          <Button variant="lime" size="lg" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        ) : (
          <Button
            variant="lime"
            size="lg"
            icon={<Wallet />}
            loading={state === "working"}
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
            {credit?.historyLinked ? "History already linked" : "Connect your wallet"}
          </Button>
        )}
      </Sheet.Footer>
    </BottomSheet>
  );
}
