"use client";

import {
  DeltaChip,
  DetailsList,
  EmptyState,
  KeyValueGrid,
  type KeyValue,
  Money,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  TextTabs,
  Ticks,
} from "@polaris/ui";
import { AlertCircle, ArrowLeft, BadgeCheck, Link2Off, LockKeyhole, ScanFace, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { MerchantAvatar } from "@/components/avatars";
import { BringHistorySheet } from "@/components/bring-history";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useCloseSheet } from "@/components/shell/sheet-host";
import { type PayMode, payLink } from "@/lib/actions";
import { useAccountState, useOwner } from "@/lib/account/hooks";
import { describeDuration, describeInterval, dueAt, getBalance, getCreditLine, type PaymentLink } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { longDate, shortDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { usd } from "@/lib/money";
import { useNow } from "@/lib/use-now";
import { n } from "@/lib/view";
import { MODE_LABEL, modesOf, type Paid, Receipt } from "@/sheets/checkout";

/**
 * A payment link from 1024px: one centred card on the framed canvas, under
 * the wordmark only. On the left the merchant and the order, on the right how
 * to pay (Pay now, Pay in 4 with its four dated payments, or Subscribe) and
 * the lime button that asks for Face ID. A shop's popup window is narrow, so
 * it keeps the phone checkout.
 */
export function CheckoutDesktop({ link }: { link: PaymentLink }) {
  const close = useCloseSheet();
  const state = useAccountState();
  const owner = useOwner();
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const now = useNow();
  const modes = modesOf(link);
  // Pay in 4 first when the link offers it: it is what the link is for.
  const [mode, setMode] = useState<PayMode>(link.modes.later ? "later" : (modes[0] ?? "now"));
  const [confirming, setConfirming] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [raising, setRaising] = useState(false);
  const id = useId();

  useEffect(() => prefetchDomains("ausd", "payments", "checkout"), []);

  const later = link.modes.later;
  const sub = link.modes.subscription;
  const available = balance.value?.available;
  const needFor = (m: PayMode) => (m === "now" ? link.amount : m === "later" ? 0n : (sub?.price ?? link.amount));
  const short = available !== undefined && state.status !== "none" && available < needFor(mode);
  const overLimit = mode === "later" && later && credit.value ? credit.value.available < later.total : false;
  const payDate = (i: number) => (later && now ? shortDate(dueAt(now, later.interval, i)) : "");
  const each = later ? usd(later.amounts[0] ?? 0n) : "";

  const title =
    mode === "later" && later ? "Start Pay in 4" : mode === "subscription" && sub ? `Subscribe for ${usd(sub.price)}` : `Pay ${usd(link.amount, { trim: true })}`;

  const numbers: KeyValue[] =
    mode === "later" && later
      ? [
          { label: "Interest", value: usd(later.interest) },
          { label: "Due today", value: usd(0n) },
          { label: "In total", value: usd(later.total) },
          { label: "Rate", value: `${later.aprBps / 100}% a year` },
        ]
      : mode === "subscription" && sub
        ? [
            { label: "Price", value: usd(sub.price) },
            { label: "Billed", value: describeInterval(sub.periodSeconds).replace(/^every /, "Every ") },
            { label: "First charge", value: "Today" },
            { label: "Cancel", value: "Any time" },
          ]
        : [
            { label: "You pay today", value: usd(link.amount) },
            { label: "Interest", value: usd(0n) },
            { label: "Fees", value: usd(0n) },
            { label: "From", value: available !== undefined && state.status !== "none" ? usd(available) : "Your dollars" },
          ];

  return (
    <div className="mx-auto w-full max-w-[1040px] pt-2">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] overflow-hidden rounded-[32px] border border-ui-hairline-strong">
        {/* The order */}
        <section aria-label="The order" className="flex flex-col p-8 xl:p-10">
          <div className="flex items-center gap-4">
            <MerchantAvatar name={link.merchant.name} size="lg" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[22px] leading-tight font-medium tracking-[-0.02em]">
                <span className="truncate">{link.merchant.name}</span>
                <BadgeCheck aria-label="Verified business" size={20} strokeWidth={1.75} className="shrink-0 text-ui-lime-text" />
              </p>
              <p className="mt-1 truncate text-[15px] text-ui-muted">
                {link.merchant.category} · {link.merchant.city}
              </p>
            </div>
          </div>

          <p className="mt-10 text-[14px] text-ui-muted">Total</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Money value={n(link.amount)} className="ui-figure text-[56px] leading-none font-medium tracking-[-0.04em]" />
            {later ? <DeltaChip value={null} label={`or 4 × ${each}`} /> : sub ? <DeltaChip value={null} label="Monthly" /> : null}
          </div>

          <DetailsList
            className="mt-8"
            items={[
              { label: "For", value: link.description },
              { label: "Order", value: link.orderId },
              { label: "Merchant", value: `${link.merchant.name}, ${link.merchant.city}` },
            ]}
          />

          <p className="mt-auto flex items-start gap-2 pt-8 text-[13px] leading-relaxed text-ui-muted">
            <LockKeyhole aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            Every payment asks for your Face ID. {link.merchant.name} is paid in full the moment you confirm.
          </p>
        </section>

        {/* How to pay */}
        <section aria-label="How to pay" className="flex flex-col gap-4 bg-ui-surface-1/40 p-8 xl:p-10">
          {modes.length > 1 ? (
            <TextTabs
              aria-label="How to pay"
              size="md"
              options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
              value={mode}
              onValueChange={setMode}
              tabId={(v) => `${id}-tab-${v}`}
              panelId={() => `${id}-panel`}
            />
          ) : (
            <p className="text-[16px] leading-none font-semibold tracking-[0.01em] text-ui-lime-active uppercase">{MODE_LABEL[modes[0] ?? "now"]}</p>
          )}

          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${mode}`} className="grid gap-4">
            {mode === "later" && later ? (
              <div className="rounded-ui-swap bg-ui-surface-1 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="ui-figure text-[34px] leading-none font-medium tracking-[-0.03em]">4 × {each}</p>
                  <StatusPill tone="purple" size="sm">
                    Nothing today
                  </StatusPill>
                </div>
                <Ticks done={0} total={later.installments} className="mt-4" />
                <ol className="mt-4 grid gap-2.5">
                  {later.amounts.map((amount, i) => (
                    <li key={i} className="flex items-center gap-3 text-[15px]">
                      <span className="ui-figure grid size-7 shrink-0 place-items-center rounded-full bg-ui-surface-2 text-[12px] font-semibold">{i + 1}</span>
                      <span className="flex-1 text-ui-muted">{now ? longDate(dueAt(now, later.interval, i)) : "…"}</span>
                      <span className="ui-figure">{usd(amount)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="rounded-ui-swap bg-ui-surface-1 p-5">
                <p className="text-[14px] text-ui-muted">{mode === "subscription" && sub ? sub.name : "Paid in full, from your dollars"}</p>
                <p className="ui-figure mt-2 text-[34px] leading-none font-medium tracking-[-0.03em]">
                  {usd(mode === "subscription" && sub ? sub.price : link.amount)}
                  {mode === "subscription" && sub ? <span className="text-[18px] text-ui-muted"> {describeInterval(sub.periodSeconds)}</span> : null}
                </p>
              </div>
            )}

            <KeyValueGrid items={numbers} />

            {mode === "later" && later && credit.value ? (
              overLimit ? (
                <p role="status" className="flex items-start gap-2 text-[14px] leading-snug text-ui-warn">
                  <AlertCircle aria-hidden size={18} strokeWidth={1.75} className="mt-px shrink-0" />
                  This plan needs {usd(later.total)} of limit and you have {usd(credit.value.available)}. Pay now, or raise your limit.
                </p>
              ) : (
                <p className="text-[14px] leading-snug text-ui-muted">
                  First payment in {describeDuration(later.interval)} ({payDate(0)}), then {describeInterval(later.interval)}. Your Pay later limit:{" "}
                  <span className="ui-figure text-ui-text">{usd(credit.value.available)}</span> of {usd(credit.value.limit, { trim: true })}.
                </p>
              )
            ) : null}
            {short ? (
              <p role="status" className="text-[14px] text-ui-down">
                Not enough dollars in your account for this.{later && mode !== "later" ? " Try Pay in 4." : ""}
              </p>
            ) : null}
          </div>

          <div className="mt-auto grid gap-3 pt-2">
            <PrimaryButton size="lg" block icon={<ScanFace />} disabled={short || overLimit} onClick={() => setConfirming(true)}>
              {title}
            </PrimaryButton>
            {mode === "later" && credit.value && !credit.value.historyLinked ? (
              <SecondaryButton size="lg" block iconRight={<TrendingUp />} onClick={() => setRaising(true)}>
                Raise your limit
              </SecondaryButton>
            ) : null}
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-center">
        <button type="button" onClick={close} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[15px] text-ui-muted transition-colors hover:text-ui-text">
          <ArrowLeft aria-hidden size={16} strokeWidth={1.75} />
          Cancel and go back
        </button>
      </div>

      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={title}
        summary={
          mode === "later" && later
            ? `${later.installments} × ${each} to ${link.merchant.name}, the first on ${payDate(0)}. Nothing to pay today. ${usd(later.interest)} interest in total.`
            : mode === "subscription" && sub
              ? `${sub.name} at ${link.merchant.name}, ${describeInterval(sub.periodSeconds)}. Cancel any time in Pay in 4.`
              : `To ${link.merchant.name}, from your dollar account.`
        }
        newLabel="Pay with Face ID"
        busyLabel="Paying…"
        onAccount={async (signer) => {
          const receipt = await payLink(signer, link, mode, { outstanding: credit.value?.used ?? 0n });
          setPaid({ mode, receipt, at: Date.now() });
        }}
      />
      {paid ? <Receipt link={link} paid={paid} onDone={close} /> : null}
      <BringHistorySheet open={raising} onOpenChange={setRaising} credit={credit.value} />
    </div>
  );
}

/** A link that doesn't resolve, on the same card. */
export function CheckoutMissing() {
  return (
    <div className="mx-auto grid w-full max-w-[560px] justify-items-center rounded-[32px] border border-ui-hairline-strong p-10">
      <EmptyState
        icon={<Link2Off />}
        title="This link doesn't go anywhere"
        description="It may have expired, or part of it went missing. Ask whoever sent it for a new one."
        action={
          <PrimaryButton asChild size="md">
            <Link href="/">Go to Polaris</Link>
          </PrimaryButton>
        }
      />
    </div>
  );
}
