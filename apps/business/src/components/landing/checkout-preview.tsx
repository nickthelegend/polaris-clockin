"use client";

import { Avatar, Button, DetailsList, KeyValueGrid, Money, SegmentedControl, cn } from "@polaris/ui";
import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { money, payInFourQuote } from "@/lib/data/format";

type Mode = "now" | "later";

const ORDER_CENTS = 200_00;
const quote = payInFourQuote(ORDER_CENTS);

/**
 * The Polaris checkout (ref C's checkout with ref B's controls), built from
 * the library, for the landing: a $200 order from an invented studio. Its
 * controls work: switch between Pay now and Pay in 4, press pay, and the
 * order settles on screen. Nothing is charged; it's a demonstration.
 */
export function CheckoutPreview({
  compact = false,
  onPaid,
  className,
}: {
  /** Fewer schedule rows, for the hero's phone. */
  compact?: boolean;
  onPaid?: (mode: Mode) => void;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>("later");
  const [state, setState] = useState<"idle" | "paying" | "paid">("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pay = (m: Mode) => {
    setMode(m);
    setState("paying");
    timers.current.push(
      setTimeout(() => {
        setState("paid");
        onPaid?.(m);
      }, 800),
      setTimeout(() => setState("idle"), 4200),
    );
  };

  const details =
    mode === "later"
      ? [
          { label: "Each week", value: money(quote.each) },
          { label: "Payments", value: "4, weekly" },
          { label: "Interest", value: money(quote.interest) },
          { label: "Total", value: money(quote.total) },
        ]
      : [
          { label: "Amount", value: money(ORDER_CENTS) },
          { label: "Fees", value: "$0.00" },
        ];

  return (
    <div className={cn("relative flex h-full flex-col px-4 pb-6", className)}>
      <div className="flex items-center gap-3 pt-1 pb-4">
        <Avatar name="Oat & Ember" tone="honey" size="md" decorative />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[17px] font-medium tracking-[-0.015em]">Oat &amp; Ember</p>
          <p className="text-[13px] text-ui-muted">Brand identity package</p>
        </div>
      </div>

      <div className="rounded-ui-tile bg-ui-surface-2 px-4 pt-3.5 pb-4">
        <p className="text-[13px] text-ui-muted">Total</p>
        <Money value={ORDER_CENTS / 100} className="mt-1 text-[34px] leading-none font-semibold tracking-[-0.035em]" />
      </div>

      <KeyValueGrid className="mt-3 gap-2.5" items={details} />

      <DetailsList
        className="mt-3"
        size="sm"
        items={
          mode === "later"
            ? [
                { label: "First payment", value: "In 1 week" },
                ...(compact ? [] : [{ label: "Second payment", value: "In 2 weeks" }]),
                { label: "Last payment", value: "In 4 weeks" },
              ]
            : [
                { label: "Merchant", value: "Oat & Ember" },
                { label: "Order", value: "#4821" },
              ]
        }
      />

      <div className="mt-auto pt-4">
        <SegmentedControl<Mode>
          aria-label="How to pay"
          block
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "now", label: "Pay now" },
            { value: "later", label: "Pay in 4" },
          ]}
        />
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Button variant="purple" size="md" onClick={() => pay("later")} disabled={state !== "idle"}>
            Pay in 4
          </Button>
          <Button variant="lime-bright" size="md" onClick={() => pay("now")} disabled={state !== "idle"}>
            Pay now
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {state !== "idle" ? (
          <motion.div
            key="receipt"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            className="absolute inset-0 grid place-items-center bg-ui-canvas/90 px-6 text-center backdrop-blur-md"
          >
            {state === "paying" ? (
              <div className="grid justify-items-center gap-3">
                <span className="size-12 animate-spin rounded-full border-[3px] border-ui-surface-3 border-t-ui-lime motion-reduce:animate-none" />
                <p className="text-[16px] font-medium">Confirming with Face ID…</p>
              </div>
            ) : (
              <motion.div
                initial={reduced ? false : { scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                className="grid justify-items-center gap-3"
              >
                <span className="grid size-16 place-items-center rounded-full bg-ui-lime text-ui-on-lime">
                  <Check size={30} strokeWidth={2.5} aria-hidden />
                </span>
                <p className="text-[22px] leading-tight font-medium tracking-[-0.02em]">Paid</p>
                <p className="max-w-[24ch] text-[14px] leading-snug text-ui-muted">
                  Oat &amp; Ember received {money(ORDER_CENTS)} in 0.8 s
                  {mode === "later" ? `. You pay ${money(quote.each)} a week, from next week.` : "."}
                </p>
              </motion.div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
