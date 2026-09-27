"use client";

import { createCheckoutMessage, quotePayIn4, type CheckoutMode, type CheckoutSession, type CheckoutMessage } from "polarispay-sdk";
import { useEffect, useState } from "react";

import { PolarisLockup } from "@/components/polaris-lockup";
import { decimalToCents, formatUsd } from "@/lib/money";

type Delivery = { eventId: string; type: string; status: number | null; attempts: number };
type Completed = { mode: CheckoutMode; orderId: string | null; txHash: `0x${string}`; paymentId?: `0x${string}`; planId?: string; subscriptionId?: string };

const MODE_TITLE: Record<CheckoutMode, string> = { now: "Pay now", later: "Pay in 4", subscribe: "Subscribe" };
const usd = (amount: string) => formatUsd(decimalToCents(amount) ?? 0);

/**
 * DEVELOPMENT MOCK of the hosted Polaris checkout (the Polaris app's
 * /pay/[id] sheet). It completes a session against the dev mock API, which
 * signs and sends the webhooks Polaris would, then answers the store exactly
 * as polarispay-sdk expects: `ready`, then `completed` or `canceled` by
 * postMessage when opened as a popup, or a redirect to the successUrl.
 */
export function TestCheckout({ session, aprBps }: { session: CheckoutSession; aprBps: number }) {
  const [mode, setMode] = useState<CheckoutMode>(session.modes[0] ?? "now");
  const [phase, setPhase] = useState<"choose" | "working" | "done" | "canceled" | "error">(session.status === "open" ? "choose" : "error");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(session.status === "open" ? null : `This checkout is ${session.status}.`);
  const quote = quotePayIn4(session.amount, { aprBps });

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
      window.setTimeout(() => post(message), 1200);
      window.setTimeout(() => window.close(), 2400);
    } else {
      window.setTimeout(() => window.location.assign(url.replace("{CHECKOUT_SESSION_ID}", session.id)), 900);
    }
  };

  const complete = async () => {
    setPhase("working");
    setError(null);
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

  return (
    <div className="min-h-dvh bg-[#0f1011] text-[#f5f5f5]">
      <div
        role="note"
        className="bg-[repeating-linear-gradient(135deg,#f5c542_0_14px,#e8b52c_14px_28px)] px-4 py-2.5 text-center text-[0.82rem] font-semibold text-[#1d1c1a]"
      >
        Polaris test checkout · development mock served by this store. Not the real Polaris checkout. No money moves.
      </div>

      <main className="mx-auto w-full max-w-[440px] px-5 pb-10 pt-8">
        <div className="flex items-center justify-between">
          <PolarisLockup className="text-[1.1rem]" />
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-wide text-amber-200">Test</span>
        </div>

        <p className="mt-8 text-[0.9rem] text-white/60">Pay Halcyon</p>
        <p className="num mt-1 text-[3rem] font-semibold leading-none tracking-[-0.03em]">
          {usd(session.amount)}
          {mode === "subscribe" ? <span className="text-[1.1rem] font-medium text-white/55"> /month</span> : null}
        </p>
        <p className="mt-2 text-[0.9rem] text-white/60">{session.description}</p>

        {session.lineItems.length > 0 ? (
          <ul className="mt-6 divide-y divide-white/10 rounded-2xl bg-white/[0.05] px-4">
            {session.lineItems.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-4 py-3 text-[0.9rem]">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="num shrink-0 text-white/80">
                  {item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {usd(item.unitAmount)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {phase === "choose" || phase === "working" ? (
          <>
            {session.modes.length > 1 ? (
              <div role="radiogroup" aria-label="How to pay" className="mt-6 grid gap-2">
                {session.modes.map((m) => (
                  <label
                    key={m}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl px-4 py-3.5 ${
                      mode === m ? "bg-white/[0.12] shadow-[inset_0_0_0_1.5px_#bffa62]" : "bg-white/[0.05]"
                    }`}
                  >
                    <input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                    <span className="font-medium">{MODE_TITLE[m]}</span>
                    <span className="num text-[0.9rem] text-white/70">{m === "later" ? `4 × ${usd(quote.each)}` : usd(session.amount)}</span>
                  </label>
                ))}
              </div>
            ) : null}

            {mode === "later" ? (
              <ol className="mt-5 grid grid-cols-4 gap-2 text-[0.78rem] text-white/55">
                {quote.installments.map((inst, i) => (
                  <li key={inst.index} className="grid gap-1.5">
                    <span className="h-1.5 rounded-full bg-white/15" />
                    <span className="num text-[0.9rem] font-medium text-white">{usd(inst.amount)}</span>
                    {`Week ${i + 1}`}
                  </li>
                ))}
              </ol>
            ) : mode === "subscribe" ? (
              <p className="mt-5 text-[0.9rem] text-white/60">
                {usd(session.amount)} today, then every {session.subscription?.interval ?? "month"}. Cancel any time.
              </p>
            ) : null}

            <button
              type="button"
              onClick={complete}
              disabled={phase === "working"}
              className="mt-8 h-14 w-full rounded-full bg-[#bffa62] text-[1rem] font-semibold text-[#0f1011] transition-transform active:scale-[0.985] disabled:opacity-60"
            >
              {phase === "working" ? "Completing…" : `Complete test payment · ${MODE_TITLE[mode]}`}
            </button>
            <button type="button" onClick={cancel} disabled={phase === "working"} className="mt-3 h-12 w-full rounded-full text-[0.92rem] text-white/70 hover:text-white">
              Cancel and return to Halcyon
            </button>
          </>
        ) : null}

        {phase === "done" ? (
          <div className="mt-8 rounded-2xl bg-white/[0.06] p-5">
            <p className="text-[1.05rem] font-semibold">Test payment complete. Returning to Halcyon…</p>
            <p className="mt-3 text-[0.8rem] uppercase tracking-wide text-white/45">Webhooks sent to the store</p>
            <ul className="mt-2 space-y-1.5 font-mono text-[0.78rem]">
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
          </div>
        ) : null}

        {phase === "canceled" ? <p className="mt-8 text-[1rem]">Canceled. Returning to Halcyon…</p> : null}
        {phase === "error" && error ? <p className="mt-8 rounded-2xl bg-rose-400/10 p-4 text-[0.92rem] text-rose-200">{error}</p> : null}
      </main>
    </div>
  );
}
