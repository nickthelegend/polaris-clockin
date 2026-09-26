"use client";

import { useState } from "react";

import { formatUsd, quotePayIn4 } from "@/lib/polaris-sdk/money";
import { PolarisLockup } from "@/lib/polaris-sdk/react";
import type { CheckoutMessage, CheckoutMode, CheckoutSession } from "@/lib/polaris-sdk/types";

type Delivery = { eventId: string; type: string; status: number | null; attempts: number };

const MODE_TITLE: Record<CheckoutMode, string> = { now: "Pay now", later: "Pay in 4", subscribe: "Subscribe" };

/**
 * DEVELOPMENT MOCK of the hosted Polaris checkout. It completes a session
 * against the dev mock API, which signs and sends the same webhooks Polaris
 * would, then hands the result back to the store the way the real checkout
 * does: postMessage to the opener, or a redirect to the successUrl.
 */
export function TestCheckout({ session, aprBps }: { session: CheckoutSession; aprBps: number }) {
  const modes = session.modes ?? ["now"];
  const [mode, setMode] = useState<CheckoutMode>(modes[0]!);
  const [phase, setPhase] = useState<"choose" | "working" | "done" | "canceled" | "error">(session.status === "open" ? "choose" : "error");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(session.status === "open" ? null : `This checkout is ${session.status}.`);
  const amount = session.amount ?? "0.00";
  const quote = quotePayIn4(amount, { aprBps });

  const reply = (status: "complete" | "canceled", chosen: CheckoutMode | null) => {
    const message: CheckoutMessage = {
      source: "polaris-checkout",
      version: 1,
      sessionId: session.id,
      status,
      mode: chosen,
      orderId: session.metadata?.orderId ?? null,
    };
    const target = status === "complete" ? session.successUrl : (session.cancelUrl ?? session.successUrl);
    if (window.opener && target) {
      window.opener.postMessage(message, new URL(target).origin);
      window.setTimeout(() => window.close(), 900);
    } else if (target) {
      window.setTimeout(() => window.location.assign(target), 900);
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
    const body = (await res.json().catch(() => ({}))) as { deliveries?: Delivery[]; error?: { message?: string } };
    if (!res.ok) {
      setPhase("error");
      setError(body.error?.message ?? "The mock couldn't complete this session.");
      return;
    }
    setDeliveries(body.deliveries ?? []);
    setPhase("done");
    reply("complete", mode);
  };

  const cancel = async () => {
    await fetch(`/api/dev-polaris/checkout/${session.id}/cancel`, { method: "POST" }).catch(() => {});
    setPhase("canceled");
    reply("canceled", null);
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
          {formatUsd(amount)}
          {mode === "subscribe" ? <span className="text-[1.1rem] font-medium text-white/55"> /month</span> : null}
        </p>
        <p className="mt-2 text-[0.9rem] text-white/60">{session.description}</p>

        {session.lineItems && session.lineItems.length > 0 ? (
          <ul className="mt-6 divide-y divide-white/10 rounded-2xl bg-white/[0.05] px-4">
            {session.lineItems.map((item) => (
              <li key={`${item.name}-${item.sku ?? ""}`} className="flex items-center justify-between gap-4 py-3 text-[0.9rem]">
                <span className="min-w-0">
                  <span className="block truncate">{item.name}</span>
                  {item.description ? <span className="block truncate text-[0.8rem] text-white/50">{item.description}</span> : null}
                </span>
                <span className="num shrink-0 text-white/80">
                  {item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {formatUsd(item.unitAmount)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {phase === "choose" || phase === "working" ? (
          <>
            {modes.length > 1 ? (
              <div role="radiogroup" aria-label="How to pay" className="mt-6 grid gap-2">
                {modes.map((m) => (
                  <label
                    key={m}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl px-4 py-3.5 ${
                      mode === m ? "bg-white/[0.12] shadow-[inset_0_0_0_1.5px_#bffa62]" : "bg-white/[0.05]"
                    }`}
                  >
                    <input type="radio" name="mode" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                    <span className="font-medium">{MODE_TITLE[m]}</span>
                    <span className="num text-[0.9rem] text-white/70">{m === "later" ? `4 × ${formatUsd(quote.each)}` : formatUsd(amount)}</span>
                  </label>
                ))}
              </div>
            ) : null}

            {mode === "later" ? (
              <ol className="mt-5 grid grid-cols-4 gap-2 text-[0.78rem] text-white/55">
                {quote.installments.map((inst, i) => (
                  <li key={inst.index} className="grid gap-1.5">
                    <span className={`h-1.5 rounded-full ${i === 0 ? "bg-[#bffa62]" : "bg-white/15"}`} />
                    <span className="num text-[0.9rem] font-medium text-white">{formatUsd(inst.amount)}</span>
                    {i === 0 ? "Today" : `Week ${i + 1}`}
                  </li>
                ))}
              </ol>
            ) : mode === "subscribe" ? (
              <p className="mt-5 text-[0.9rem] text-white/60">
                {formatUsd(amount)} today, then every {session.subscription?.interval ?? "month"}. Cancel any time.
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
