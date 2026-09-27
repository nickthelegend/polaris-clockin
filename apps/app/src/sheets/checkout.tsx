"use client";

import {
  Badge,
  Button,
  Card,
  DetailsList,
  EmptyState,
  IconButton,
  type KeyValue,
  KeyValueGrid,
  Money,
  ScreenHeader,
  SegmentedControl,
  Sheet,
  toast,
} from "@polaris/ui";
import { AlertCircle, BadgeCheck, Link2Off, Share2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MerchantAvatar } from "@/components/avatars";
import { BringHistorySheet } from "@/components/bring-history";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { RouteSheet, useCloseSheet } from "@/components/shell/sheet-host";
import { SuccessSheet } from "@/components/success-sheet";
import { type PayMode, payLink } from "@/lib/actions";
import { useAccountState, useOwner } from "@/lib/account/hooks";
import { describeDuration, describeInterval, getBalance, getCreditLine, type PaymentLink } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { shortDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { usd } from "@/lib/money";
import type { RelayReceipt } from "@/lib/relayer";
import { useNow } from "@/lib/use-now";
import { n } from "@/lib/view";

type Paid = { mode: PayMode; receipt: RelayReceipt; at: number };

const MODE_LABEL: Record<PayMode, string> = { now: "Pay now", later: "Pay in 4", subscription: "Subscribe" };

function modesOf(link: PaymentLink): PayMode[] {
  const modes: PayMode[] = [];
  if (link.modes.now) modes.push("now");
  if (link.modes.later) modes.push("later");
  if (link.modes.subscription) modes.push("subscription");
  return modes;
}

/** Checkout /pay/[id] (full), on ref C's trade screen and ref B: the merchant, the numbers, Pay in 4 or Pay now. */
export function CheckoutSheet({ link }: { link: PaymentLink }) {
  const close = useCloseSheet();
  const state = useAccountState();
  const owner = useOwner();
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const now = useNow();
  const modes = modesOf(link);
  const [mode, setMode] = useState<PayMode>(modes[0] ?? "now");
  const [confirming, setConfirming] = useState<PayMode | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [raising, setRaising] = useState(false);

  // Read the signing domains now, so Confirm goes straight to Face ID.
  useEffect(() => prefetchDomains("ausd", "payments", "checkout"), []);

  const later = link.modes.later;
  const sub = link.modes.subscription;
  const available = balance.value?.available;
  const needFor = (m: PayMode) => (m === "now" ? link.amount : m === "later" ? (later?.amounts[0] ?? 0n) : (sub?.price ?? link.amount));
  const short = (m: PayMode) => available !== undefined && state.status !== "none" && available < needFor(m);
  const overLimit = later && credit.value ? credit.value.available < later.total : false;

  const grid: KeyValue[] =
    mode === "later" && later
      ? [
          { label: "Amount", value: usd(link.amount) },
          { label: "Pay in 4", value: `${usd(later.amounts[0] ?? 0n)} × ${later.installments}` },
          { label: "Interest", value: usd(later.interest) },
          { label: "First payment", value: "Today" },
        ]
      : mode === "subscription" && sub
        ? [
            { label: "Price", value: usd(sub.price) },
            { label: "Billed", value: describeInterval(sub.periodSeconds).replace(/^every /, "Every ") },
            { label: "First charge", value: "Today" },
            { label: "Cancel", value: "Any time" },
          ]
        : [
            { label: "Amount", value: usd(link.amount) },
            { label: "You pay today", value: usd(link.amount) },
            { label: "Interest", value: usd(0n) },
            { label: "Fees", value: usd(0n) },
          ];

  const details: KeyValue[] = [
    {
      label: "Merchant",
      value: (
        <span className="inline-flex items-center gap-1.5">
          {link.merchant.name}
          <BadgeCheck aria-label="Verified business" size={16} strokeWidth={1.75} className="text-ui-lime" />
        </span>
      ),
    },
    { label: "For", value: link.description },
    { label: "Order", value: link.orderId },
  ];
  if (mode === "later" && later && now) {
    later.amounts.slice(1).forEach((amount, i) => {
      const label = i === later.amounts.length - 2 ? "Last payment" : i === 0 ? "Second payment" : "Third payment";
      details.push({ label, value: `${usd(amount)} · ${shortDate(now + (i + 1) * later.interval * 1000)}` });
    });
  } else if (mode === "now") {
    details.push({
      label: "From",
      value: available !== undefined && state.status !== "none" ? `Dollar account · ${usd(available)}` : "Your dollar account",
    });
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Pay ${link.merchant.name}`, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" });
    }
  }

  const actions: PayMode[] = modes.length > 1 ? [modes.find((m) => m !== "now") ?? modes[1]!, "now"] : modes;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        variant="arrow"
        title={link.merchant.name}
        subtitle={`${link.merchant.category} · ${link.merchant.city}`}
        onBack={close}
        action={<IconButton label="Share this link" icon={<Share2 />} tone="ink" onClick={() => void share()} />}
        className="-mt-2 shrink-0 px-5"
      />
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-3 pt-1">
        <Card variant="raised" radius="tile" padding="md" className="flex items-center gap-4">
          <MerchantAvatar name={link.merchant.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-ui-muted">Total</p>
            <Money value={n(link.amount)} dim="cents" className="mt-1 text-[36px] leading-none font-semibold tracking-[-0.03em]" />
          </div>
          {later ? <Badge tone="lime">Pay in 4</Badge> : sub ? <Badge tone="purple">Monthly</Badge> : null}
        </Card>

        {modes.length > 1 ? (
          <Card variant="raised" radius="tile" padding="md" className="flex items-center justify-between gap-3">
            <span className="text-[16px] text-ui-muted">Pay</span>
            <SegmentedControl
              aria-label="How to pay"
              value={mode}
              onValueChange={setMode}
              options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            />
          </Card>
        ) : null}

        <KeyValueGrid items={grid} />
        <DetailsList items={details} />

        {mode === "later" && later && credit.value ? (
          <Card variant="raised" radius="tile" padding="md" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[16px] font-medium">Your Pay later limit</span>
              <span className="ui-figure text-[15px]">
                {usd(credit.value.available)} <span className="text-ui-muted">of {usd(credit.value.limit, { trim: true })}</span>
              </span>
            </div>
            {overLimit ? (
              <p role="status" className="flex items-start gap-2 text-[14px] leading-snug text-ui-warn">
                <AlertCircle aria-hidden size={18} strokeWidth={1.75} className="mt-px shrink-0" />
                This plan needs {usd(later.total)} of limit. Pay now, or raise your limit.
              </p>
            ) : (
              <p className="text-[14px] leading-snug text-ui-muted">
                Today, then {describeInterval(later.interval)}. {later.aprBps / 100}% a year, {usd(later.total)} in total.
              </p>
            )}
            {!credit.value.historyLinked ? (
              <Button variant="outline" size="md" icon={<TrendingUp />} onClick={() => setRaising(true)}>
                Raise your limit
              </Button>
            ) : null}
          </Card>
        ) : null}

        {short(mode) ? (
          <p role="status" className="text-center text-[14px] text-ui-down">
            Not enough dollars in your account for this.{later && mode !== "later" ? " Try Pay in 4." : ""}
          </p>
        ) : null}
      </Sheet.Body>
      <Sheet.Footer>
        {actions.map((m) => (
          <Button
            key={m}
            variant={m === "now" ? "lime" : "purple"}
            size="lg"
            disabled={short(m) || (m === "later" && overLimit)}
            onClick={() => {
              setMode(m);
              setConfirming(m);
            }}
          >
            {actions.length === 1 ? `${MODE_LABEL[m]} ${usd(needFor(m), { trim: true })}` : MODE_LABEL[m]}
          </Button>
        ))}
      </Sheet.Footer>

      <ConfirmSheet
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={
          confirming === "later" && later
            ? `Pay ${usd(later.amounts[0] ?? 0n)} today`
            : confirming === "subscription" && sub
              ? `Subscribe for ${usd(sub.price)}`
              : `Pay ${usd(link.amount, { trim: true })}`
        }
        summary={
          confirming === "later" && later
            ? `To ${link.merchant.name} now, then ${later.installments - 1} more ${describeInterval(later.interval)}. ${usd(later.interest)} interest in total.`
            : confirming === "subscription" && sub
              ? `${sub.name} at ${link.merchant.name}, ${describeInterval(sub.periodSeconds)}. Cancel any time in Plans.`
              : `To ${link.merchant.name}, from your dollar account.`
        }
        newLabel="Pay with Face ID"
        busyLabel="Paying…"
        onAccount={async (signer) => {
          const m = confirming ?? mode;
          const receipt = await payLink(signer, link, m, { outstanding: credit.value?.used ?? 0n });
          setPaid({ mode: m, receipt, at: Date.now() });
        }}
      />

      {paid ? <Receipt link={link} paid={paid} onDone={close} /> : null}
      <BringHistorySheet open={raising} onOpenChange={setRaising} credit={credit.value} />
    </div>
  );
}

function Receipt({ link, paid, onDone }: { link: PaymentLink; paid: Paid; onDone: () => void }) {
  const later = link.modes.later;
  const sub = link.modes.subscription;

  // Tell the merchant's page that opened us, and only that page.
  useEffect(() => {
    if (!link.successUrl || !window.opener) return;
    try {
      const target = new URL(link.successUrl).origin;
      (window.opener as Window).postMessage(
        { type: "polaris:payment", status: "paid", linkId: link.id, orderId: link.orderId, mode: paid.mode, txHash: paid.receipt.txHash },
        target,
      );
    } catch {
      /* no opener to tell */
    }
  }, [link, paid]);

  const subtitle =
    paid.mode === "later" && later
      ? `${usd(later.amounts[0] ?? 0n)} to ${link.merchant.name}. Next payment in ${describeDuration(later.interval)}.`
      : paid.mode === "subscription" && sub
        ? `Subscribed to ${link.merchant.name}. Next charge in ${describeDuration(sub.periodSeconds)}.`
        : `${usd(link.amount)} to ${link.merchant.name}.`;

  const rows: KeyValue[] = [{ label: "For", value: link.description }];
  if (paid.mode === "later" && later) {
    rows.push({ label: "Paid today", value: usd(later.amounts[0] ?? 0n) }, { label: "Plan", value: `${later.installments} × ${usd(later.amounts[0] ?? 0n)}` });
  } else if (paid.mode === "subscription" && sub) {
    rows.push({ label: "Paid today", value: usd(sub.price) }, { label: "Then", value: `${usd(sub.price)} ${describeInterval(sub.periodSeconds)}` });
  } else {
    rows.push({ label: "Paid", value: usd(link.amount) });
  }
  rows.push({ label: "Order", value: link.orderId });

  const done = () => {
    if (link.successUrl) window.location.assign(link.successUrl);
    else onDone();
  };

  return (
    <SuccessSheet
      open
      onOpenChange={() => done()}
      title="Paid."
      subtitle={subtitle}
      rows={rows}
      receiptUrl={paid.receipt.explorerUrl}
      primary={{ label: link.successUrl ? `Back to ${link.merchant.name}` : "Done", onClick: done }}
    />
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function CheckoutRoute({ link, cold }: { cold?: boolean } & { link: PaymentLink | null }) {
  return (
    <RouteSheet label={link ? `Pay ${link.merchant.name}` : "Payment link"} snapPoints={["full"]} cold={cold}>
      {link ? (
        <CheckoutSheet link={link} />
      ) : (
        <Sheet.Body className="pt-10">
          <EmptyState
            icon={<Link2Off />}
            title="This link doesn't go anywhere"
            description="It may have expired, or part of it went missing. Ask whoever sent it for a new one."
            action={
              <Button asChild variant="white" size="lg">
                <Link href="/">Go to Polaris</Link>
              </Button>
            }
          />
        </Sheet.Body>
      )}
    </RouteSheet>
  );
}
