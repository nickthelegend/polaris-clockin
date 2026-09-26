"use client";

import { Check, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { getAddress, isAddress } from "viem";

import { SampleDataNote } from "@/components/shell";
import {
  Button,
  DisplayMoney,
  EmptyState,
  ErrorState,
  Field,
  InlineMessage,
  PageHeader,
  Skeleton,
  Status,
  Switch,
  TextInput,
} from "@/components/ui";
import type { Address, AutoPayouts, Payout, PayoutsState } from "@/lib/data/types";
import { formatDateTime, money, parseAmount, shortAddress } from "@/lib/data/format";
import { AUTO_PAYOUTS_LIVE, useAutoPayouts, useWithdraw, WITHDRAWALS_SIGNED } from "@/lib/payouts";
import { useQuery } from "@/lib/session";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    // Privy rejects with this when the person closes its confirmation.
    if (/reject|denied|cancel/i.test(error.message)) return "You cancelled the confirmation. Nothing was sent.";
    return error.message;
  }
  return fallback;
}

function checkAddress(value: string, own: Address | null): string | null {
  const v = value.trim();
  if (!v) return "Enter the address to send to.";
  if (!isAddress(v, { strict: false })) return "That isn't an address. It starts with 0x and has 40 more characters.";
  if (/^0x0{40}$/i.test(v)) return "The zero address can't receive money.";
  if (own && getAddress(v) === own) return "That's your Polaris payout account itself. Enter where the money should go.";
  return null;
}

export function PayoutsView() {
  const { data, error, loading, reload, mutate } = useQuery((d) => d.getPayouts());

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Move your balance anywhere, in one tap or automatically every day. There's no network fee to pay and nothing to hold but dollars."
      />
      <SampleDataNote />

      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <WithdrawPanel
            state={data}
            loading={loading}
            onWithdrawn={(payout) =>
              mutate((s) =>
                s ? { ...s, balanceCents: s.balanceCents - payout.amountCents, history: [payout, ...s.history] } : s,
              )
            }
          />
          <AutoPayoutsPanel
            state={data}
            loading={loading}
            onChange={(auto) => mutate((s) => (s ? { ...s, auto } : s))}
          />
          <div className="min-w-0 lg:col-span-2">
            <HistoryPanel history={data?.history} loading={loading} />
          </div>
        </div>
      )}
    </>
  );
}

/* ── Withdraw ───────────────────────────────────────────────────────────── */

function WithdrawPanel({
  state,
  loading,
  onWithdrawn,
}: {
  state: PayoutsState | undefined;
  loading: boolean;
  onWithdrawn: (payout: Payout) => void;
}) {
  const withdraw = useWithdraw();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const balance = state?.balanceCents ?? 0;
  const cents = parseAmount(amount);
  const amountError = !touched
    ? null
    : cents === null
      ? "Enter an amount like 250 or 250.50."
      : cents > balance
        ? `You can withdraw up to ${money(balance)}.`
        : null;
  const destinationError = touched ? checkAddress(destination, state?.walletAddress ?? null) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setResult(null);
    if (cents === null || cents > balance || checkAddress(destination, state?.walletAddress ?? null)) return;

    setBusy(true);
    try {
      const payout = await withdraw(cents, getAddress(destination.trim()));
      onWithdrawn(payout);
      setResult({
        tone: "success",
        text: `${money(payout.amountCents)} is on its way to ${shortAddress(payout.destination)}. It arrives in under a second once sent.`,
      });
      setAmount("");
      setDestination("");
      setTouched(false);
    } catch (err) {
      setResult({ tone: "error", text: errorMessage(err, "We couldn't start the withdrawal. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="withdraw-title" className="panel relative isolate overflow-hidden p-6 sm:p-7">
      <div aria-hidden className="grid-ground absolute inset-x-0 top-0 -z-10 h-[180px]" />
      <h2 id="withdraw-title" className="flex items-center gap-2 text-[14px] text-muted">
        <span aria-hidden className="inline-block h-[11px] w-[15px] rounded-[3px] bg-lime" />
        Available to withdraw
      </h2>
      <p className="mt-3 text-[48px]">
        {loading || !state ? <Skeleton width="5ch" /> : <DisplayMoney cents={state.balanceCents} />}
      </p>

      <form onSubmit={submit} noValidate className="mt-7 grid gap-4">
        <Field label="Amount" htmlFor="withdraw-amount" error={amountError}>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] text-muted">
              $
            </span>
            <TextInput
              id="withdraw-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              invalid={Boolean(amountError)}
              aria-describedby={amountError ? "withdraw-amount-error" : undefined}
              className="figure pr-16 pl-7 text-[16px]"
            />
            <button
              type="button"
              onClick={() => setAmount((balance / 100).toFixed(2))}
              disabled={!state || balance === 0}
              className="press absolute top-1/2 right-1.5 h-8 -translate-y-1/2 rounded-full bg-pill px-3 text-[12.5px] font-medium hover:bg-line-strong disabled:opacity-40"
            >
              Max
            </button>
          </div>
        </Field>

        <Field
          label="Send to"
          htmlFor="withdraw-to"
          error={destinationError}
          hint="Any Monad address, including an exchange deposit address."
        >
          <TextInput
            id="withdraw-to"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            invalid={Boolean(destinationError)}
            aria-describedby={destinationError ? "withdraw-to-error" : "withdraw-to-hint"}
            className="machine"
          />
        </Field>

        <div className="grid gap-3 pt-1">
          <Button type="submit" size="lg" loading={busy} disabled={!state}>
            Withdraw
          </Button>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {WITHDRAWALS_SIGNED
              ? "You confirm once with your payout account. Polaris submits the transfer and pays the network fee."
              : "Sample mode: AUSD isn't configured, so this records the withdrawal without asking your payout account to confirm."}
          </p>
          {result ? <InlineMessage tone={result.tone}>{result.text}</InlineMessage> : null}
        </div>
      </form>
    </section>
  );
}

/* ── Automatic payouts ──────────────────────────────────────────────────── */

function AutoPayoutsPanel({
  state,
  loading,
  onChange,
}: {
  state: PayoutsState | undefined;
  loading: boolean;
  onChange: (auto: AutoPayouts) => void;
}) {
  const { enable, disable } = useAutoPayouts();
  const auto = state?.auto;
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const value = address ?? auto?.payoutAddress ?? "";
  const addressError = attempted ? checkAddress(value, state?.walletAddress ?? null) : null;
  const target = value && isAddress(value.trim(), { strict: false }) ? value.trim() : null;

  async function toggle(next: boolean) {
    setResult(null);
    if (next) {
      setAttempted(true);
      if (checkAddress(value, state?.walletAddress ?? null)) return;
    }
    setBusy(true);
    try {
      const updated = next
        ? await enable(getAddress(value.trim()))
        : await disable(auto?.payoutAddress ?? null);
      onChange(updated);
      setAddress(null);
      setAttempted(false);
      setResult({
        tone: "success",
        text: next
          ? `On. Your balance goes to ${shortAddress(updated.payoutAddress ?? "")} every day at ${String(updated.hourUtc).padStart(2, "0")}:00 UTC.`
          : "Off. Nothing will be sent until you withdraw or turn this back on.",
      });
    } catch (err) {
      setResult({ tone: "error", text: errorMessage(err, "We couldn't change automatic payouts. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  const changedAddress = auto?.enabled && address !== null && address.trim() !== (auto.payoutAddress ?? "");

  return (
    <section aria-labelledby="auto-title" className="panel p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="auto-title" className="section-title">
            Automatic daily payouts
          </h2>
          <p id="auto-desc" className="max-w-[48ch] text-[13.5px] leading-relaxed text-muted">
            Once a day, Polaris sends your whole balance to one payout address you choose. You don&rsquo;t sign each
            payout.
          </p>
        </div>
        {loading || !auto ? (
          <Skeleton width="48px" height="28px" />
        ) : (
          <Switch
            checked={auto.enabled}
            onChange={toggle}
            busy={busy}
            label="Automatic daily payouts"
            describedBy="auto-desc auto-policy"
          />
        )}
      </div>

      <div className="mt-5 grid gap-3">
        <Field
          label="Payout address"
          htmlFor="auto-address"
          error={addressError}
          hint={auto?.enabled ? "Changing it takes effect when you save." : "Where every daily payout goes."}
        >
          <TextInput
            id="auto-address"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={value}
            onChange={(e) => setAddress(e.target.value)}
            invalid={Boolean(addressError)}
            aria-describedby={addressError ? "auto-address-error" : "auto-address-hint"}
            className="machine"
          />
        </Field>
        {changedAddress ? (
          <div>
            <Button size="sm" loading={busy} onClick={() => void toggle(true)}>
              Save payout address
            </Button>
          </div>
        ) : null}
        {result ? <InlineMessage tone={result.tone}>{result.text}</InlineMessage> : null}
      </div>

      {/* The guarantee, in plain words. */}
      <div id="auto-policy" className="mt-6 rounded-[16px] bg-key p-4">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <ShieldCheck className="size-4" aria-hidden />
          Locked to your payout address
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          A Privy policy on your payout account lets our server sign exactly one thing for you: sending your dollars to{" "}
          {target ? <span className="machine text-text">{shortAddress(target)}</span> : "the address above"}. It is
          enforced inside Privy&rsquo;s secure enclave, not by our code, so even we can&rsquo;t send your money anywhere
          else.
        </p>
        <ul className="mt-3 grid gap-1.5 text-[13px]">
          <li className="flex items-start gap-2">
            <Check className="mt-[2px] size-3.5 shrink-0 text-lime-text" aria-hidden />
            Dollars from your payout account to your payout address, on Monad
          </li>
          <li className="flex items-start gap-2 text-muted">
            <X className="mt-[2px] size-3.5 shrink-0" aria-hidden />
            Any other address, any other token, exporting your key, or changing the rule
          </li>
        </ul>
        {!AUTO_PAYOUTS_LIVE ? (
          <p className="mt-3 text-[12.5px] text-muted">
            Sample mode: the payout signer isn&rsquo;t configured, so this saves your choice without adding it.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ── History ────────────────────────────────────────────────────────────── */

function HistoryPanel({ history, loading }: { history: Payout[] | undefined; loading: boolean }) {
  return (
    <section aria-labelledby="history-title" className="panel min-w-0 p-2 sm:p-3">
      <h2 id="history-title" className="section-title px-3 pt-3 pb-3 sm:px-4">
        History
      </h2>
      <div className="hidden overflow-x-auto md:block">
        <table className="ledger min-w-[640px]">
          <caption className="sr-only">Payout history, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">To</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {loading || !history ? (
              Array.from({ length: 4 }, (_, i) => (
                <tr key={i}>
                  {[10, 14, 7, 7, 8].map((w, j) => (
                    <td key={j} className={j === 4 ? "num" : undefined}>
                      <Skeleton width={`${w}ch`} />
                    </td>
                  ))}
                </tr>
              ))
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No payouts yet">Withdrawals and automatic payouts appear here with where they went.</EmptyState>
                </td>
              </tr>
            ) : (
              history.map((p) => (
                <tr key={p.id}>
                  <td className="figure whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</td>
                  <td>
                    <span className="machine text-[12.5px]" title={p.destination}>
                      {shortAddress(p.destination, 8, 6)}
                    </span>
                  </td>
                  <td>{p.kind === "automatic" ? "Automatic" : "Withdrawal"}</td>
                  <td>
                    {p.status === "paid" ? (
                      <Status tone="neutral">Paid</Status>
                    ) : p.status === "queued" ? (
                      <Status tone="muted">Queued</Status>
                    ) : (
                      <Status tone="danger">Failed</Status>
                    )}
                  </td>
                  <td className="num font-medium">{money(p.amountCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phones: one entry per payout. */}
      <ul className="grid md:hidden" aria-label="Payout history, newest first">
        {loading || !history ? (
          [0, 1, 2].map((i) => (
            <li key={i} className="grid gap-2 border-b border-line px-3 py-4 last:border-0">
              <Skeleton width="50%" />
              <Skeleton width="30%" />
            </li>
          ))
        ) : history.length === 0 ? (
          <li>
            <EmptyState title="No payouts yet">Withdrawals and automatic payouts appear here with where they went.</EmptyState>
          </li>
        ) : (
          history.map((p) => (
            <li key={p.id} className="grid gap-1 border-b border-line px-3 py-3.5 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="machine truncate text-[13px]" title={p.destination}>
                  {shortAddress(p.destination, 8, 6)}
                </span>
                <span className="figure shrink-0 font-medium">{money(p.amountCents)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
                <span className="figure">
                  {formatDateTime(p.createdAt)} · {p.kind === "automatic" ? "Automatic" : "Withdrawal"}
                </span>
                {p.status === "paid" ? (
                  <Status tone="neutral" className="text-[12.5px]">Paid</Status>
                ) : p.status === "queued" ? (
                  <Status tone="muted" className="text-[12.5px]">Queued</Status>
                ) : (
                  <Status tone="danger" className="text-[12.5px]">Failed</Status>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
