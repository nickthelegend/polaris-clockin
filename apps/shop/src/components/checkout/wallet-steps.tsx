"use client";

import { AlertIcon, CheckIcon, Spinner } from "@/components/icons";
import type { PayButtonState } from "@/lib/polaris-client";

type State = PayButtonState | "confirming" | "paid";

const STEPS = [
  { id: "connect", label: "Connect your wallet" },
  { id: "network", label: "Use Monad Testnet" },
  { id: "sign", label: "Confirm the payment in your wallet" },
  { id: "relay", label: "Polaris sends it, gas-free" },
  { id: "confirm", label: "Payment confirmed" },
] as const;

export const ACTIVE_STEP: Partial<Record<State, number>> = {
  connecting: 0,
  switching_network: 1,
  signing: 2,
  relaying: 3,
  submitting: 3,
  submitted: 4,
  confirming: 4,
  paid: 5,
};

/** Where a direct wallet payment is, step by step, including the ways it can stop. */
export function WalletSteps({ state, error, lastStep }: { state: State; error: string | null; lastStep: number }) {
  const failed = state === "rejected" || state === "wrong_network" || state === "no_wallet" || state === "error";
  const active = failed ? (state === "wrong_network" ? 1 : state === "no_wallet" ? 0 : lastStep) : ACTIVE_STEP[state];

  return (
    <div className="mt-5">
      <ol className="space-y-3" aria-label="Wallet payment progress">
        {STEPS.map((step, i) => {
          const done = active !== undefined && i < active;
          const current = active === i;
          const stopped = failed && current;
          return (
            <li key={step.id} className="flex items-center gap-3 text-[0.94rem]" aria-current={current ? "step" : undefined}>
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                  stopped ? "bg-alert-soft text-alert" : done ? "bg-ok text-paper" : current ? "bg-ink text-paper" : "shadow-[inset_0_0_0_1.5px_var(--color-hair-strong)]"
                }`}
              >
                {stopped ? <AlertIcon size={15} /> : done ? <CheckIcon size={14} strokeWidth={2} /> : current ? <Spinner size={13} /> : null}
              </span>
              <span className={done || current ? "text-ink" : "text-faint"}>
                {step.id === "confirm" && state === "paid" ? "Paid" : step.label}
                {step.id === "confirm" && state === "confirming" ? <span className="text-muted"> · waiting for Polaris</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="mt-4 flex gap-2.5 rounded-lg bg-alert-soft px-3.5 py-3 text-[0.9rem] text-alert">
          <AlertIcon size={18} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
