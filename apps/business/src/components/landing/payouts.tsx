"use client";

import { Badge, Card, CardStack, Money, Toggle } from "@polaris/ui";
import { ArrowUpFromLine, CalendarClock, Check, Fuel, Send, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Rise } from "@/components/motion";
import { payouts } from "./content";
import { SectionIntro, Shell } from "./section";

const ICONS = [<Send key="send" size={18} />, <Fuel key="fuel" size={18} />, <ShieldCheck key="shield" size={18} />];

/** "Easy withdraw": the ref D balance card, a one-tap withdrawal and the daily sweep, as a demo. */
export function Payouts() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [auto, setAuto] = useState(false);
  const [balance, setBalance] = useState(6274.5);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const withdraw = () => {
    if (state !== "idle") return;
    setState("sending");
    timers.current.push(
      setTimeout(() => {
        setState("sent");
        setBalance((b) => Math.max(0, Math.round((b - 1250) * 100) / 100));
      }, 800),
      setTimeout(() => {
        setState("idle");
        setBalance(6274.5);
      }, 5200),
    );
  };

  return (
    <section id="payouts" aria-labelledby="payouts-title" className="scroll-mt-24 py-20 lg:py-28">
      <Shell className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Rise y={32} blur={8} duration={0.9} className="order-2 min-w-0 lg:order-1">
          <Card padding="lg" className="ring-1 ring-white/5">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-[15px] text-ui-muted">Your payout account</p>
              <Badge tone="neutral">Demo · nothing moves</Badge>
            </div>
            <CardStack
              name="Oat & Ember"
              last4="91c2"
              meta="AUSD"
              balance={balance}
              deltaLabel="This week"
              delta={11.05}
              actions={[
                { label: "Withdraw $1,250.00", icon: <ArrowUpFromLine />, tone: "mint", onClick: withdraw },
                { label: auto ? "Turn off automatic payouts" : "Turn on automatic payouts", icon: <CalendarClock />, tone: "honey", onClick: () => setAuto((a) => !a) },
              ]}
            />
            <div className="mt-4 min-h-[64px]" aria-live="polite">
              <AnimatePresence mode="wait">
                {state === "idle" ? (
                  <motion.button
                    key="idle"
                    type="button"
                    onClick={withdraw}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex w-full items-center justify-between rounded-ui-row bg-ui-surface-2 px-4 py-3.5 text-left transition-colors hover:bg-ui-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
                  >
                    <span className="text-[15px]">
                      Withdraw <Money value={1250} dim="cents" className="font-medium" /> to 0x7a3f…91c2
                    </span>
                    <span className="rounded-full bg-ui-lime px-3 py-1.5 text-[13px] font-medium text-ui-on-lime">Withdraw</span>
                  </motion.button>
                ) : (
                  <motion.div
                    key={state}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-between rounded-ui-row bg-ui-surface-2 px-4 py-3.5"
                  >
                    <span className="flex items-center gap-3 text-[15px]">
                      {state === "sending" ? (
                        <span className="size-7 animate-spin rounded-full border-[3px] border-ui-surface-3 border-t-ui-lime motion-reduce:animate-none" />
                      ) : (
                        <span className="grid size-7 place-items-center rounded-full bg-ui-lime text-ui-on-lime">
                          <Check size={15} strokeWidth={2.5} aria-hidden />
                        </span>
                      )}
                      {state === "sending" ? "Confirm once, the relayer sends it…" : "Sent in 0.8 s. Network fee: $0.00"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="mt-4 rounded-ui-row bg-ui-surface-2 px-4 py-3.5">
              <Toggle
                checked={auto}
                onCheckedChange={setAuto}
                label="Automatic daily payouts"
                description={
                  auto
                    ? "Every day at 17:00 UTC, to 0x7a3f…91c2 only. A Privy session signer does it, so you never sign again."
                    : "Sweep your balance every day to one address you choose."
                }
              />
            </div>
          </Card>
        </Rise>

        <div className="order-1 lg:order-2">
          <SectionIntro id="payouts-title" eyebrow={payouts.eyebrow} heading={payouts.heading} sub={payouts.sub} />
          <ul className="mt-10 grid gap-5">
            {payouts.features.map((f, i) => (
              <Rise as="li" key={f.title} y={14} delay={0.15 + i * 0.1} className="grid grid-cols-[44px_minmax(0,1fr)] gap-4">
                <span className="grid size-11 place-items-center rounded-full bg-ui-surface-1 text-ui-lime ring-1 ring-white/6">{ICONS[i]}</span>
                <span>
                  <span className="block text-[18px] font-medium tracking-[-0.015em]">{f.title}</span>
                  <span className="mt-1 block text-[15px] leading-[1.5] text-ui-muted">{f.body}</span>
                </span>
              </Rise>
            ))}
          </ul>
        </div>
      </Shell>
    </section>
  );
}
