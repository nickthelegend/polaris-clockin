"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createCheckoutMessage, type CheckoutMode, type CheckoutSession, type CheckoutMessage } from "polarispay-sdk";
import Image from "next/image";
import { useEffect, useState } from "react";

import { PolarisLockup } from "@/components/polaris-lockup";
import { HalcyonMark } from "@/components/wordmark";
import { decimalToCents, formatUsd } from "@/lib/money";
import { aprLabel, payIn4 } from "@/lib/pay-in-4";

type Delivery = { eventId: string; type: string; status: number | null; attempts: number };
type Completed = { mode: CheckoutMode; orderId: string | null; txHash: `0x${string}`; paymentId?: `0x${string}`; planId?: string; subscriptionId?: string };
type Phase = "choose" | "faceid" | "working" | "done" | "canceled" | "error";

/** The same names the store uses for each way to pay. */
const MODE_TITLE: Record<CheckoutMode, string> = { now: "Pay now", later: "Pay in 4", subscribe: "Subscribe" };
/** A new buyer's opening Pay in 4 limit in the mock (real lines run from $200 to $1,000). */
const MOCK_LIMIT = 50_000;
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const EASE = [0.16, 1, 0.3, 1] as const;

const cents = (amount: string) => decimalToCents(amount) ?? 0;

/** "$349" with ".00" dimmed, the Polaris money style. */
function Money({ value, className = "" }: { value: number; className?: string }) {
  const text = formatUsd(value);
  const dot = text.lastIndexOf(".");
  return (
    <span className={`num ${className}`}>
      {text.slice(0, dot)}
      <span className="text-white/40">{text.slice(dot)}</span>
    </span>
  );
}

function FaceIdGlyph({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true" className="text-[#bffa62]">
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 20V12a6 6 0 0 1 6-6h8M44 6h8a6 6 0 0 1 6 6v8M58 44v8a6 6 0 0 1-6 6h-8M20 58h-8a6 6 0 0 1-6-6v-8" />
        {done ? (
          <path d="m20 33 8 8 16-17" />
        ) : (
          <>
            <path d="M23 24v4M41 24v4M32 24v10l-3 2" />
            <path d="M24 43c4.5 3.5 11.5 3.5 16 0" />
          </>
        )}
      </g>
    </svg>
  );
}

/**
 * DEVELOPMENT MOCK of the hosted Polaris checkout (the Polaris app's
 * /pay/[id] sheet), styled after it: the merchant and what's being paid
 * for, the way to pay, the figures (with Pay in 4's interest and first
 * date), the buyer's limit, and Face ID. It completes a session against the
 * dev mock API, which signs and sends the webhooks Polaris would, then
 * answers the store exactly as polarispay-sdk expects: `ready`, then
 * `completed` or `canceled` by postMessage when opened as a popup, or a
 * redirect to the successUrl.
 */
export function TestCheckout({
  session,
  aprBps,
  thumbnails,
}: {
  session: CheckoutSession;
  aprBps: number;
  thumbnails: { name: string; image: string }[];
}) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<CheckoutMode>(session.modes[0] ?? "now");
  const [phase, setPhase] = useState<Phase>(session.status === "open" ? "choose" : "error");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(session.status === "open" ? null : `This checkout is ${session.status}.`);
  const [why, setWhy] = useState(false);
  const [now] = useState(() => Date.now());

  const amount = cents(session.amount);
  const plan = session.modes.includes("later") ? payIn4(amount, aprBps) : null;
  const overLimit = mode === "later" && plan !== null && plan.total > MOCK_LIMIT;
  const firstDate = plan ? SHORT_DATE.format(new Date(now + plan.installments[0]!.dueInSeconds * 1000)) : "";
  const interval = session.subscription?.interval ?? "month";

  const opener = (): Window | null => {
    const popup = new URLSearchParams(window.location.search).get("display") === "popup";
    return popup && window.opener ? (window.opener as Window) : null;
  };
  const post = (message: CheckoutMessage) => opener()?.postMessage(message, new URL(session.successUrl).origin);

  useEffect(() => {
    post(createCheckoutMessage("ready", session.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the checkout has loaded
  }, []);

  const leave = (message: CheckoutMessage, url: string) => {
    if (opener()) {
      // A beat to read the confirmation; the store closes this window when the message lands.
      window.setTimeout(() => post(message), 1400);
      window.setTimeout(() => window.close(), 2600);
    } else {
      window.setTimeout(() => window.location.assign(url.replace("{CHECKOUT_SESSION_ID}", session.id)), 1100);
    }
  };

  const complete = async () => {
    setError(null);
    // Face ID, as the Polaris app asks for it, before anything is sent.
    setPhase("faceid");
    await new Promise((r) => setTimeout(r, reduce ? 300 : 900));
    setPhase("working");
    const res = await fetch(`/api/dev-polaris/checkout/${session.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: Completed; deliveries?: Delivery[]; error?: { message?: string } };
    if (!res.ok || !body.result) {
      setPhase("error");
      setError(body.error?.message ?? "The mock couldn't complete this session.");
      return;
    }
    setDeliveries(body.deliveries ?? []);
    setPhase("done");
    const { mode: paidWith, orderId, ...details } = body.result;
    leave(createCheckoutMessage("completed", session.id, { mode: paidWith, ...(orderId ? { orderId } : {}), ...details }), session.successUrl);
  };

  const cancel = async () => {
    await fetch(`/api/dev-polaris/checkout/${session.id}/cancel`, { method: "POST" }).catch(() => {});
    setPhase("canceled");
    leave(createCheckoutMessage("canceled", session.id), session.cancelUrl ?? session.successUrl);
  };

  const figures: { label: string; value: string }[] =
    mode === "later" && plan
      ? [
          { label: "Pay in 4", value: `${formatUsd(plan.each)} × 4` },
          { label: "Interest", value: `${formatUsd(plan.interest)} · ${aprLabel(plan.aprBps)}` },
          { label: "First payment", value: firstDate },
          { label: "Due today", value: formatUsd(0) },
        ]
      : mode === "subscribe"
        ? [
            { label: "Price", value: formatUsd(amount) },
            { label: "Billed", value: interval === "month" ? "Monthly" : `Every ${interval}` },
            { label: "First charge", value: "Today" },
            { label: "Cancel", value: "Any time" },
          ]
        : [
            { label: "Amount", value: formatUsd(amount) },
            { label: "You pay today", value: formatUsd(amount) },
            { label: "Interest", value: formatUsd(0) },
            { label: "Fees", value: formatUsd(0) },
          ];

  const choosing = phase === "choose" || phase === "faceid" || phase === "working";

  return (
    <div className="min-h-dvh bg-[#0f1011] text-[#f5f5f5]">
      <main className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-6 pt-6">
        <div className="flex items-center justify-between">
          <PolarisLockup className="text-[1.1rem]" />
          <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-amber-200">Test</span>
        </div>

        {/* The merchant, and what the buyer is paying for. */}
        <section aria-label="Paying Halcyon" className="mt-6 rounded-[22px] bg-white/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f2eee7] text-[#1d1c1a]">
              <HalcyonMark size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-semibold">
                Halcyon
                <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Verified business" className="text-[#bffa62]">
                  <path d="m12 2 2.4 2.1 3.2-.2.7 3.1 2.7 1.8-1.2 3 1.2 3-2.7 1.8-.7 3.1-3.2-.2L12 22l-2.4-2.1-3.2.2-.7-3.1-2.7-1.8 1.2-3-1.2-3 2.7-1.8.7-3.1 3.2.2z" fill="currentColor" />
                  <path d="m8.5 12.2 2.3 2.3 4.7-4.8" fill="none" stroke="#0f1011" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </p>
              <p className="text-[0.82rem] text-white/55">Home goods · Berlin</p>
            </div>
            {session.modes.includes("later") ? (
              <span className="rounded-full bg-[#bffa62]/15 px-2.5 py-1 text-[0.74rem] font-semibold text-[#d9fca0]">Pay in 4</span>
            ) : session.modes.includes("subscribe") ? (
              <span className="rounded-full bg-violet-300/15 px-2.5 py-1 text-[0.74rem] font-semibold text-violet-200">Monthly</span>
            ) : null}
          </div>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/10 pt-4">
            <div>
              <p className="text-[0.85rem] text-white/55">Total</p>
              <p className="mt-1 text-[2.4rem] font-semibold leading-none tracking-[-0.03em]">
                <Money value={amount} />
                {mode === "subscribe" ? <span className="text-[1rem] font-medium text-white/55"> /{interval}</span> : null}
              </p>
            </div>
            {thumbnails.length > 0 ? (
              <div className="flex -space-x-3" aria-hidden="true">
                {thumbnails.slice(0, 3).map((t) => (
                  <span key={t.name} className="relative h-12 w-12 overflow-hidden rounded-xl bg-[#f2eee7] ring-2 ring-[#1a1b1c]">
                    <Image src={t.image} alt="" fill sizes="48px" className="object-cover" />
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-2 truncate text-[0.85rem] text-white/55">
            {thumbnails.length > 0 ? thumbnails.map((t) => t.name).join(" · ") : session.description}
          </p>
        </section>

        {choosing ? (
          <>
            {session.modes.length > 1 ? (
              <div role="radiogroup" aria-label="How to pay" className="mt-3 flex items-center justify-between gap-3 rounded-[22px] bg-white/[0.06] p-2 pl-4">
                <span className="text-[0.95rem] text-white/60">Pay</span>
                <div className="flex rounded-full bg-black/30 p-1">
                  {session.modes.map((m) => (
                    <label
                      key={m}
                      className={`cursor-pointer rounded-full px-4 py-2 text-[0.88rem] font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#bffa62] ${
                        mode === m ? "bg-white text-[#0f1011]" : "text-white/70 hover:text-white"
                      }`}
                    >
                      <input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                      {MODE_TITLE[m]}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <dl className="mt-3 grid grid-cols-2 gap-2">
              {figures.map((f) => (
                <div key={f.label} className="rounded-2xl bg-white/[0.06] px-4 py-3">
                  <dt className="text-[0.78rem] text-white/50">{f.label}</dt>
                  <dd className="num mt-0.5 text-[1.02rem] font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>

            {mode === "later" && plan ? (
              <>
                <div className="mt-3 rounded-2xl bg-white/[0.06] px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.95rem] font-medium">Your limit</span>
                    <span className="num text-[0.95rem]">
                      {formatUsd(MOCK_LIMIT)}{" "}
                      <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="ml-1 text-[#d9fca0] underline decoration-[#d9fca0]/40 underline-offset-4">
                        Why?
                      </button>
                    </span>
                  </div>
                  {why ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.84rem] leading-snug text-white/60">
                      <li>Scored on chain from your AUSD balance, account age and repayments.</li>
                      <li>A new account opens at {formatUsd(MOCK_LIMIT)}. Repay on time and it grows, up to $5,000.</li>
                    </ul>
                  ) : null}
                  {overLimit ? (
                    <p role="status" className="mt-2 text-[0.86rem] leading-snug text-amber-200">
                      This plan needs {formatUsd(plan.total)} of limit. Pay now instead, or pay part of your order another way.
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.84rem] leading-snug text-white/55">
                      Nothing today. {formatUsd(plan.each)} is collected every week, automatically, from {firstDate}.
                    </p>
                  )}
                </div>
              </>
            ) : mode === "subscribe" ? (
              <p className="mt-3 px-1 text-[0.88rem] text-white/60">
                {formatUsd(amount)} today, then every {interval}. Skip or cancel any time in Polaris.
              </p>
            ) : null}

            {/* The action stays in view at the foot of the sheet, as in the Polaris app. */}
            <div className="sticky bottom-0 -mx-5 mt-auto bg-gradient-to-t from-[#0f1011] from-70% to-transparent px-5 pb-3 pt-6">
              <button
                type="button"
                onClick={complete}
                disabled={phase !== "choose" || overLimit}
                aria-busy={phase !== "choose" || undefined}
                className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#bffa62] text-[1rem] font-semibold text-[#0f1011] transition-transform active:scale-[0.985] disabled:cursor-default disabled:opacity-60 aria-busy:opacity-100"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2M9 9v1.5M15 9v1.5M12 9v4.5l-1.2.8M9 16c1.7 1.3 4.3 1.3 6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {phase === "working" ? "Confirming…" : mode === "later" ? "Continue with Face ID · Pay in 4" : mode === "subscribe" ? "Continue with Face ID · Subscribe" : `Continue with Face ID · ${formatUsd(amount)}`}
              </button>
              <button type="button" onClick={cancel} disabled={phase !== "choose"} className="mt-2 h-12 w-full rounded-full text-[0.92rem] text-white/65 hover:text-white">
                Cancel and return to Halcyon
              </button>
            </div>
          </>
        ) : null}

        {phase === "done" ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="mt-6 rounded-[22px] bg-white/[0.06] p-5"
            role="status"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#bffa62] text-[#0f1011]">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <p className="mt-4 text-[1.35rem] font-semibold tracking-[-0.02em]">
              {mode === "later" ? "Paid. Next payment in a week." : mode === "subscribe" ? "Subscribed." : "Paid."}
            </p>
            <p className="mt-1 text-[0.92rem] text-white/60">
              {mode === "later" && plan
                ? `Halcyon has its ${formatUsd(amount)}. Your first payment of ${formatUsd(plan.each)} is on ${firstDate}.`
                : mode === "subscribe"
                  ? `${formatUsd(amount)} today, then every ${interval}.`
                  : `${formatUsd(amount)} to Halcyon.`}{" "}
              Returning to Halcyon…
            </p>
            {deliveries.length > 0 ? (
              <details className="mt-4 border-t border-white/10 pt-3 text-[0.8rem] text-white/55">
                <summary className="cursor-pointer">Webhooks the mock sent to the store</summary>
                <ul className="mt-2 space-y-1.5 font-mono text-[0.76rem]">
                  {deliveries.map((d) => (
                    <li key={d.eventId} className="flex justify-between gap-3">
                      <span>{d.type}</span>
                      <span className={d.status && d.status < 300 ? "text-[#bffa62]" : "text-rose-300"}>
                        {d.status ?? "failed"}
                        {d.attempts > 1 ? ` after ${d.attempts} tries` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </motion.div>
        ) : null}

        {phase === "canceled" ? <p className="mt-8 text-[1rem]">Canceled. Returning to Halcyon…</p> : null}
        {phase === "error" && error ? <p className="mt-8 rounded-2xl bg-rose-400/10 p-4 text-[0.92rem] text-rose-200">{error}</p> : null}

        <p className="mt-5 text-center text-[0.74rem] leading-snug text-white/40">
          Test checkout: a development mock served by Halcyon, not the real Polaris checkout. No money moves.
        </p>

        <AnimatePresence>
          {phase === "faceid" || phase === "working" ? (
            <motion.div
              key="faceid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-10 grid place-items-center bg-black/55 backdrop-blur-[2px]"
              role="status"
              aria-label={phase === "faceid" ? "Face ID" : "Confirming"}
            >
              <motion.div
                initial={reduce ? false : { scale: 0.92 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="grid w-44 place-items-center gap-3 rounded-[28px] bg-[#1a1b1d] py-7"
              >
                <motion.div animate={phase === "faceid" && !reduce ? { opacity: [0.55, 1, 0.55] } : { opacity: 1 }} transition={{ duration: 0.9, repeat: Infinity }}>
                  <FaceIdGlyph done={phase === "working"} />
                </motion.div>
                <p className="text-[0.9rem] font-medium">Face ID</p>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}
