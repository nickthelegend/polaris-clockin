"use client";

import {
  Avatar,
  Button,
  Card,
  CardStack,
  CellStack,
  DetailsList,
  Dialog,
  Drawer,
  EmptyState,
  Input,
  KeyValueGrid,
  Money,
  Notice,
  Skeleton,
  Toggle,
  TxRow,
  toast,
} from "@polaris/ui";
import { ArrowUpFromLine, CalendarClock, Check, Copy, Landmark, ShieldCheck, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getAddress, isAddress, zeroAddress } from "viem";

import { Address, PayoutStatusBadge, TxLink } from "@/components/dashboard/bits";
import { DataModeNotice, LoadError, Panel, SampleBadge, StaleNotice } from "@/components/dashboard/common";
import { DashboardHeader } from "@/components/shell/dashboard-shell";
import { errorMessage, DataError } from "@/lib/data";
import { formatDateTime, money, parseAmount, shortAddress } from "@/lib/data/format";
import type { Address as Hex, AutoPayouts, Payout, PayoutsState } from "@/lib/data/types";
import { useMerchant } from "@/lib/merchant-context";
import { useAutoPayouts, useWithdraw } from "@/lib/payouts";
import { useDashboardData, useQuery, useReadiness, useSample, type QueryState } from "@/lib/session";

/**
 * Check a destination the way the server does: 0x and 40 hex characters; a
 * mixed-case address must match its checksum (a typo protection we keep);
 * all-lowercase or all-uppercase is fine.
 */
function checkAddress(raw: string, own: string | null): { address: Hex } | { error: string } {
  const v = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return { error: "Enter an address: 0x followed by 40 letters and numbers." };
  const body = v.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && !isAddress(v, { strict: true })) return { error: "Check the address: its capitalisation doesn't match its checksum." };
  const address = getAddress(v.toLowerCase());
  if (address === zeroAddress) return { error: "The zero address can't receive money." };
  if (own && address === getAddress(own)) return { error: "That's your payout account itself. Enter where the money should go." };
  return { address };
}

/** Payouts shown at a time in the history. */
const HISTORY_PAGE = 8;

export function PayoutsView() {
  const { merchant } = useMerchant();
  const sample = useSample();
  const ready = useReadiness();
  const payouts = useQuery((d) => d.getPayouts(), { refreshMs: 30_000 });
  const [open, setOpen] = useState<Payout | null>(null);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const withdrawRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef<HTMLDivElement>(null);
  const state = payouts.data;
  const wallet = state?.walletAddress ?? merchant.walletAddress;

  const copy = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      toast({ title: "Copied the payout address", tone: "success", duration: 2200 });
    } catch {
      toast({ title: "We couldn't copy the address", description: wallet, tone: "error" });
    }
  };
  const focus = (el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  };

  return (
    <>
      <DashboardHeader
        title="Payouts"
        description="Your balance is dollars (AUSD) in a payout account only you control. Move it in one tap, or every day on its own."
      />
      <StaleNotice queries={[payouts as QueryState<unknown>]} />
      <DataModeNotice empty={state !== undefined && state.balanceCents === 0 && state.history.length === 0} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel title="Balance" sample={sample.on} className="xl:col-span-5" subtitle="Settled from your payments, in dollars">
          {payouts.error && !state ? (
            <LoadError query={payouts as QueryState<unknown>} title="We couldn't load your balance" />
          ) : !state ? (
            <Skeleton shape="card" height={260} className="mt-5" />
          ) : (
            <>
              <CardStack
                className="mt-5"
                name={merchant.businessName ?? "Your business"}
                last4={wallet ? wallet.slice(-4) : "····"}
                meta="AUSD"
                balance={state.balanceCents / 100}
                balanceLabel="Available"
                actions={[
                  {
                    label: "Withdraw",
                    icon: <ArrowUpFromLine />,
                    tone: "mint",
                    onClick: () => focus(withdrawRef.current),
                    title: ready.withdraw ? "Withdraw (not available yet: see why beside it)" : "Withdraw",
                  },
                  { label: "Copy payout address", icon: <Copy />, tone: "outline", onClick: copy, disabled: !wallet },
                  { label: "Automatic payouts", icon: <CalendarClock />, tone: "honey", onClick: () => focus(autoRef.current) },
                ]}
              />
              <DetailsList
                className="mt-4"
                size="sm"
                items={[
                  {
                    label: "Payout account",
                    value: wallet ? <Address value={wallet} label="payout address" explorer={!sample.on} /> : "Setting up…",
                  },
                  { label: "Network fee", value: "$0.00, always" },
                ]}
              />
            </>
          )}
        </Panel>

        <div ref={withdrawRef} className="xl:col-span-7">
          <WithdrawPanel state={state} wallet={wallet} onDone={payouts.reload} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div ref={autoRef} className="xl:col-span-5">
          <AutoPayoutsPanel
            auto={state?.auto}
            wallet={wallet}
            onChange={(auto) => payouts.mutate((s) => (s ? { ...s, auto } : s))}
            onPaidOut={payouts.reload}
          />
        </div>
        <Panel title="History" sample={sample.on} className="xl:col-span-7" subtitle="Every withdrawal and automatic payout">
          {!state ? (
            <div className="mt-5 grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} shape="row" height={64} />
              ))}
            </div>
          ) : state.history.length === 0 ? (
            <EmptyState size="sm" icon={<Landmark />} title="No payouts yet" description="Withdrawals and daily payouts show here with their status." />
          ) : (
            <ul className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2">
              {state.history.slice(0, historyLimit).map((p) => (
                <li key={p.id}>
                  <TxRow
                    variant="card"
                    leading={<Avatar name={p.kind === "automatic" ? "Automatic" : "Withdrawal"} icon={<ArrowUpFromLine />} tone={p.kind === "automatic" ? "honey" : "mint"} size="md" decorative />}
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{p.kind === "automatic" ? "Automatic payout" : "Withdrawal"}</span>
                        {sample.on ? <SampleBadge /> : null}
                      </span>
                    }
                    subtitle={`To ${shortAddress(p.destination)} · ${formatDateTime(p.createdAt)}`}
                    value={<span className="ui-figure">{money(p.amountCents)}</span>}
                    subAmount={p.status === "paid" ? "Paid" : p.status === "queued" ? "Queued" : "Failed"}
                    onClick={() => setOpen(p)}
                    aria-label={`${p.kind === "automatic" ? "Automatic payout" : "Withdrawal"} of ${money(p.amountCents)}, ${p.status}. Open it.`}
                  />
                </li>
              ))}
            </ul>
          )}
          {state && state.history.length > historyLimit ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ui-muted">
                Showing {historyLimit} of {state.history.length}
              </p>
              <Button variant="outline" size="sm" onClick={() => setHistoryLimit((l) => l + HISTORY_PAGE)}>
                Show {Math.min(HISTORY_PAGE, state.history.length - historyLimit)} more
              </Button>
            </div>
          ) : null}
        </Panel>
      </div>

      <PayoutDrawer payout={open} sample={sample.on} onClose={() => setOpen(null)} />
    </>
  );
}

/* ── Withdraw: review, confirm, then a receipt with the real status ─────── */

function WithdrawPanel({ state, wallet, onDone }: { state?: PayoutsState; wallet: string | null; onDone: () => void }) {
  const withdraw = useWithdraw();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; destination?: string }>({});
  const [review, setReview] = useState<{ cents: number; to: Hex } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Payout | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const blocker = useReadiness().withdraw;
  const ready = !blocker && Boolean(wallet) && state !== undefined;
  const balance = state?.balanceCents ?? 0;

  const toReview = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const cents = parseAmount(amount);
    if (cents === null) next.amount = "Enter an amount, like 250 or 99.50.";
    else if (cents > balance) next.amount = `You can withdraw up to ${money(balance)}.`;
    const checked = checkAddress(destination, wallet);
    if ("error" in checked) next.destination = checked.error;
    setErrors(next);
    if (Object.keys(next).length || cents === null || "error" in checked) return;
    setFailure(null);
    setReview({ cents, to: checked.address });
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setFailure(null);
    try {
      const payout = await withdraw(review.cents, review.to);
      setReceipt(payout);
      setAmount("");
      setDestination("");
      onDone();
    } catch (err) {
      const message = err instanceof DataError ? err.message : errorMessage(err, "The withdrawal didn't go through. Nothing was sent.");
      setFailure(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Withdraw" subtitle="To any address, with no network fee" className="h-full">
      {blocker ? (
        <Notice tone="info" className="mt-5" id="withdraw-blocked" title="Withdrawals aren't open yet">
          {blocker}
        </Notice>
      ) : null}
      <form onSubmit={toReview} noValidate className="mt-5 grid gap-4" aria-describedby={blocker ? "withdraw-blocked" : undefined}>
        <Input
          label="Amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          disabled={!ready}
          trailing={
            <button
              type="button"
              disabled={!ready || balance === 0}
              onClick={() => setAmount((balance / 100).toFixed(2))}
              className="-mr-2 h-8 rounded-full bg-ui-surface-3 px-3 text-[13px] font-medium text-ui-text disabled:opacity-40"
            >
              Max
            </button>
          }
          hint={`Available: ${money(balance)}`}
        />
        <Input
          label="To"
          placeholder="0x… an exchange deposit address, a treasury"
          autoComplete="off"
          spellCheck={false}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          error={errors.destination}
          disabled={!ready}
          className="font-mono text-[14px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[13px] text-ui-muted">
            <ShieldCheck aria-hidden size={16} strokeWidth={1.75} className="text-ui-lime" />
            You confirm with your payout account; our relayer pays the gas.
          </p>
          <Button type="submit" variant="lime" icon={<ArrowUpFromLine />} disabled={!ready}>
            Review withdrawal
          </Button>
        </div>
      </form>

      <Dialog
        open={review !== null || receipt !== null}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setReview(null);
            setReceipt(null);
          }
        }}
        size="sm"
        dismissible={!busy}
        title={receipt ? (receipt.status === "paid" ? "Withdrawal sent" : receipt.status === "failed" ? "Withdrawal failed" : "Withdrawal queued") : "Confirm withdrawal"}
        description={receipt ? receipt.id : "Check the amount and the address. Payouts can't be reversed."}
      >
        <Dialog.Body className="grid gap-4">
          {receipt ? (
            <>
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-ui-lime text-ui-on-lime">
                  <Check size={18} strokeWidth={2.5} aria-hidden />
                </span>
                <Money value={receipt.amountCents / 100} className="text-[32px] font-semibold tracking-[-0.03em]" />
              </div>
              <DetailsList
                size="sm"
                items={[
                  { label: "Status", value: <PayoutStatusBadge status={receipt.status} /> },
                  { label: "To", value: shortAddress(receipt.destination) },
                  { label: "Network fee", value: "$0.00" },
                ]}
              />
              <p className="text-[14px] leading-relaxed text-ui-muted">
                {receipt.status === "queued"
                  ? "Your signed withdrawal is queued for the relayer. It shows as Paid, with its transaction, once it's on chain."
                  : receipt.status === "paid"
                    ? "Sent. The transaction is in your history."
                    : "It didn't go through. Nothing was sent."}
              </p>
            </>
          ) : review ? (
            <>
              <KeyValueGrid
                items={[
                  { label: "Amount", value: money(review.cents) },
                  { label: "Network fee", value: "$0.00" },
                ]}
              />
              <DetailsList size="sm" items={[{ label: "To", value: <span className="font-mono text-[13px] break-all">{review.to}</span> }]} />
              {failure ? (
                <Notice tone="down" size="sm" role="alert">
                  {failure}
                </Notice>
              ) : null}
            </>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          {receipt ? (
            <Button variant="lime" onClick={() => setReceipt(null)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>
                Back
              </Button>
              <Button variant="lime" loading={busy} onClick={confirm} icon={<ArrowUpFromLine />}>
                Confirm and withdraw
              </Button>
            </>
          )}
        </Dialog.Footer>
      </Dialog>
    </Panel>
  );
}

/* ── Automatic payouts: the Privy session signer ────────────────────────── */

function AutoPayoutsPanel({
  auto,
  wallet,
  onChange,
  onPaidOut,
}: {
  auto?: AutoPayouts;
  wallet: string | null;
  onChange: (a: AutoPayouts) => void;
  onPaidOut: () => void;
}) {
  const sample = useSample();
  const data = useDashboardData();
  const { enable, disable } = useAutoPayouts();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const blocker = useReadiness().autoPayouts;
  const canEnable = !blocker && Boolean(wallet);
  const enabled = auto?.enabled ?? false;

  const payNow = async () => {
    setError(null);
    setRunning(true);
    try {
      const run = await data.payoutNow();
      if (run.result === "failed") setError(run.detail ?? "The payout didn't go through. Nothing was sent.");
      else toast({ title: run.result === "paid" ? "Paying out your balance" : "Nothing to pay out", description: run.detail, tone: run.result === "paid" ? "success" : "info" });
      onPaidOut();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const toggle = async (on: boolean) => {
    setError(null);
    if (!on) {
      setBusy(true);
      try {
        onChange(await disable(auto?.payoutAddress ?? null));
        toast({ title: "Automatic payouts are off", tone: "success" });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    const checked = checkAddress(address || auto?.payoutAddress || "", wallet);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    try {
      onChange(await enable(checked.address));
      toast({ title: "Automatic payouts are on", description: `Daily to ${shortAddress(checked.address)}.`, tone: "success" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const hour = String(auto?.hourUtc ?? 17).padStart(2, "0");
  return (
    <Panel title="Automatic payouts" sample={sample.on} subtitle="Sweep your balance every day, without signing each time" className="h-full">
      {!auto ? (
        <Skeleton shape="tile" height={200} className="mt-5" />
      ) : (
        <>
          <div className="mt-5 rounded-ui-row bg-ui-surface-2 px-4 py-3.5">
            <Toggle
              label="Automatic daily payouts"
              description={`Every day at ${hour}:00 UTC, your whole balance goes to one address you choose.`}
              checked={enabled}
              // Turning off always works; turning on needs the signer and the sweep.
              disabled={busy || (enabled ? false : !canEnable)}
              onCheckedChange={toggle}
            />
          </div>
          {!enabled && canEnable ? (
            <Input
              wrapperClassName="mt-4"
              label="Pay out to"
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-[14px]"
              spellCheck={false}
            />
          ) : null}
          {error ? (
            <Notice tone="down" size="sm" className="mt-4" role="alert">
              {error}
            </Notice>
          ) : null}
          {enabled && blocker ? (
            <Notice tone="warn" size="sm" className="mt-4" title="Recorded as on, but not running">
              {blocker} Nothing is sent automatically until then.
            </Notice>
          ) : blocker ? (
            <Notice tone="info" size="sm" className="mt-4">
              {blocker}
            </Notice>
          ) : null}
          <DetailsList
            className="mt-4"
            size="sm"
            items={[
              { label: "Status", value: enabled ? (blocker ? "On, not running" : "On") : "Off" },
              { label: "Pays out to", value: auto.payoutAddress ? shortAddress(auto.payoutAddress) : "Not set" },
              { label: "Next payout", value: enabled && !blocker && auto.nextRunAt ? formatDateTime(auto.nextRunAt) : "—" },
            ]}
          />
          {enabled && !blocker ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ui-muted">Don&rsquo;t want to wait for {hour}:00 UTC?</p>
              <Button variant="outline" size="sm" icon={<Zap />} loading={running} onClick={() => void payNow()}>
                Pay out now
              </Button>
            </div>
          ) : null}
          <p className="mt-4 text-[13px] leading-relaxed text-ui-muted">
            A Privy session signer does the daily sweep. Its policy lets it send AUSD to your chosen address and nowhere else,
            and you can remove it at any time by turning this off.
          </p>
        </>
      )}
    </Panel>
  );
}

function PayoutDrawer({ payout, sample, onClose }: { payout: Payout | null; sample: boolean; onClose: () => void }) {
  const [last, setLast] = useState<Payout | null>(payout);
  if (payout && payout !== last) setLast(payout);
  const p = payout ?? last;
  const title = p?.kind === "automatic" ? "Automatic payout" : "Withdrawal";
  const items = useMemo(
    () =>
      p
        ? [
            { label: "Status", value: <PayoutStatusBadge status={p.status} /> },
            { label: "To", value: <Address value={p.destination} label="destination address" explorer={!sample} /> },
            { label: "When", value: formatDateTime(p.createdAt) },
            { label: "Confirmed by", value: p.signed ? "Your payout account's signature" : "Not signed" },
            { label: "Transaction", value: <TxLink hash={p.txHash} sample={sample} /> },
          ]
        : [],
    [p, sample],
  );
  return (
    <Drawer open={payout !== null} onOpenChange={(o) => !o && onClose()} title={title} description={p?.id}>
      {p ? (
        <Drawer.Body>
          <div className="flex items-center gap-3 pb-5">
            <Avatar name={title} icon={<ArrowUpFromLine />} tone={p.kind === "automatic" ? "honey" : "mint"} size="lg" decorative />
            <CellStack title={title} sub={formatDateTime(p.createdAt)} />
            {sample ? <SampleBadge className="ml-auto" /> : null}
          </div>
          <Money value={p.amountCents / 100} className="text-[44px] leading-none font-semibold tracking-[-0.035em]" />
          <KeyValueGrid
            className="mt-6"
            items={[
              { label: "Amount", value: money(p.amountCents) },
              { label: "Network fee", value: "$0.00" },
            ]}
          />
          <DetailsList className="mt-4" size="sm" items={items} />
          {p.status === "queued" ? (
            <Card variant="raised" radius="tile" padding="md" className="mt-4 text-[14px] leading-relaxed text-ui-muted">
              Queued means your signed withdrawal is waiting for the relayer. It turns Paid, with its transaction, once it&rsquo;s
              on chain.
            </Card>
          ) : null}
        </Drawer.Body>
      ) : null}
    </Drawer>
  );
}
