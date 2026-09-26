"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { BringHistorySheet } from "@/components/bring-history";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { InstallHint } from "@/components/install-hint";
import { LocalEquivalent } from "@/components/money";
import { ReceiptRows } from "@/components/receipt-sheet";
import { Button, Card, cx, ScreenHeader, Skeleton, stagger } from "@/components/ui";
import { type PayMode, payLink } from "@/lib/actions";
import { useAccountState } from "@/lib/account/hooks";
import { describeDuration, describeInterval, getBalance, getCreditLine, type PaymentLink } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { longDate, shortDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { usd, usdParts } from "@/lib/money";
import type { RelayReceipt } from "@/lib/relayer";
import { useNow } from "@/lib/use-now";

type Paid = { mode: PayMode; receipt: RelayReceipt; at: number };

function defaultMode(link: PaymentLink): PayMode {
  if (link.modes.now) return "now";
  if (link.modes.later) return "later";
  return "subscription";
}

export function Checkout({ link }: { link: PaymentLink }) {
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const credit = useData(() => getCreditLine(owner), [owner]);
  const [mode, setMode] = useState<PayMode>(() => defaultMode(link));
  const [paid, setPaid] = useState<Paid | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const now = useNow();
  const groupLabel = useId();

  // Read the signing domains now, so Confirm goes straight to Face ID.
  useEffect(() => prefetchDomains("ausd", "payments", "checkout"), []);

  const later = link.modes.later;
  const sub = link.modes.subscription;
  const available = balance.value?.available;
  const needNow =
    mode === "now" ? link.amount : mode === "later" ? (later?.amounts[0] ?? 0n) : (sub?.price ?? link.amount);
  const shortOfMoney = available !== undefined && account.status !== "none" && available < needNow;
  const overLimit = mode === "later" && later && credit.value ? credit.value.available < later.total : false;

  if (paid) return <Receipt link={link} paid={paid} />;

  const { whole, cents } = usdParts(link.amount);

  return (
    <main id="main" className="px-4 pb-[calc(190px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="Checkout" back="/" right={<HelpButton />} />

      {/* Merchant, as the "Send to" card */}
      <Card className="rise p-4" style={stagger(0)}>
        <p className="text-[15px] text-muted">Pay to</p>
        <div className="mt-3 flex items-center gap-3 border-t border-divider pt-3">
          <Avatar name={link.merchant.name} kind="merchant" size={52} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[17px] font-medium">
              {link.merchant.name}
              <span className="grid size-4 place-items-center rounded-full bg-lime text-on-lime" title="Verified business">
                <Icon name="check" size={11} strokeWidth={3} />
                <span className="sr-only">Verified business</span>
              </span>
            </p>
            <p className="truncate text-[14px] text-muted">
              {link.merchant.category} · {link.merchant.city}
            </p>
          </div>
        </div>
      </Card>

      {/* Amount */}
      <section className="rise py-8 text-center" style={stagger(1)} aria-label="Amount">
        <p className="tabular font-display text-[64px] leading-none font-bold tracking-[-0.05em]">
          {whole}
          <span className="text-[40px] tracking-[-0.04em]">{cents === ".00" ? "" : cents}</span>
        </p>
        <p className="mt-2 text-[15px]">
          <LocalEquivalent amount={link.amount} />
        </p>
        <p className="mx-auto mt-3 max-w-[30ch] text-[16px] text-fg">{link.description}</p>
      </section>

      {/* How to pay */}
      <h2 id={groupLabel} className="rise mb-3 px-1 text-[15px] font-medium text-muted" style={stagger(2)}>
        How do you want to pay?
      </h2>
      <div role="radiogroup" aria-labelledby={groupLabel} className="rise flex flex-col gap-3" style={stagger(3)}>
        {link.modes.now ? (
          <Option
            checked={mode === "now"}
            onSelect={() => setMode("now")}
            title="Pay now"
            figure={usd(link.amount)}
            detail={
              available !== undefined && account.status !== "none"
                ? `From your dollar account · ${usd(available)} available`
                : "From your dollar account"
            }
          />
        ) : null}

        {later ? (
          <Option
            checked={mode === "later"}
            onSelect={() => setMode("later")}
            title={`Pay in ${later.installments}`}
            figure={`${later.installments} × ${usd(later.amounts[0] ?? 0n)}`}
            detail={`Today, then ${describeInterval(later.interval)} · ${usd(later.interest)} interest in total`}
          >
            <Schedule link={link} now={now} />
          </Option>
        ) : null}

        {sub ? (
          <Option
            checked={mode === "subscription"}
            onSelect={() => setMode("subscription")}
            title="Subscribe"
            figure={`${usd(sub.price)}`}
            detail={`${describeInterval(sub.periodSeconds).replace(/^every /, "Every ")} · cancel anytime in Plans`}
          />
        ) : null}
      </div>

      {/* The limit, and why */}
      {mode === "later" && later ? (
        <Card className="mt-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-medium">Your Pay later limit</h3>
            {credit.value ? (
              <p className="tabular text-[15px]">
                <span className="font-medium">{usd(credit.value.available)}</span>
                <span className="text-muted"> of {usd(credit.value.limit, { trim: true })}</span>
              </p>
            ) : (
              <Skeleton className="h-4 w-28" />
            )}
          </div>
          {credit.value ? (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-divider pt-3" aria-label="Why your limit is what it is">
              {credit.value.reasons.map((r) => (
                <li key={r.label} className="flex justify-between gap-3 text-[14px] text-muted">
                  <span>{r.label}</span>
                  <span className={cx("tabular", r.points > 0 ? "text-positive" : "text-muted")}>
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {overLimit && credit.value ? (
            <p className="mt-3 rounded-[14px] bg-pill px-3 py-2.5 text-[14px]" role="status">
              This plan needs {usd(later.total)} of limit and you have {usd(credit.value.available)}. Pay now, or raise
              your limit.
            </p>
          ) : null}
          {credit.value && !credit.value.historyLinked ? (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="press mt-3 flex w-full items-center gap-3 rounded-[16px] bg-surface-2 p-3 text-left ring-1 ring-hairline ring-inset"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime text-on-lime">
                <Icon name="trendUp" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">Raise your limit</span>
                <span className="block text-[13px] text-muted">Bring your history from a wallet you already use</span>
              </span>
              <Icon name="chevronRight" size={18} className="text-muted" />
            </button>
          ) : null}
        </Card>
      ) : null}

      <BringHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} credit={credit.value} />

      {/* Confirm */}
      <div className="column-fixed bottom-0 z-30 bg-gradient-to-t from-[var(--bg-bottom)] from-70% to-transparent px-4 pt-8 pb-[calc(16px+env(safe-area-inset-bottom))]">
        {shortOfMoney ? (
          <p className="mb-3 text-center text-[14px] text-negative" role="status">
            Not enough dollars in your account for this. {later && mode !== "later" ? "Try Pay in 4." : ""}
          </p>
        ) : null}
        <FaceIdAction
          label={mode === "later" ? "Confirm with Face ID" : `Pay ${usd(needNow, { trim: true })} with Face ID`}
          newLabel="Pay with Face ID"
          busyLabel="Paying…"
          disabled={shortOfMoney || overLimit}
          hint={
            account.status === "none"
              ? "Face ID creates your Polaris account and confirms this payment, in one go."
              : undefined
          }
          onAccount={async (signer) => {
            const receipt = await payLink(signer, link, mode, { outstanding: credit.value?.used ?? 0n });
            setPaid({ mode, receipt, at: Date.now() });
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    </main>
  );
}

/** A selectable surface card; the selected one gets an ink ring and a filled dot. */
function Option({
  checked,
  onSelect,
  title,
  figure,
  detail,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  figure: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-card bg-surface transition-shadow duration-200",
        checked ? "shadow-[inset_0_0_0_2px_var(--fg)]" : "shadow-[inset_0_0_0_1px_var(--divider)]",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className="press flex w-full items-center gap-3 rounded-card p-4 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "grid size-6 shrink-0 place-items-center rounded-full",
            checked ? "bg-fg text-bg" : "ring-[1.5px] ring-hairline ring-inset",
          )}
        >
          {checked ? <Icon name="check" size={14} strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-medium">{title}</span>
            <span className="tabular font-display text-[19px] font-semibold tracking-[-0.02em]">{figure}</span>
          </span>
          <span className="mt-0.5 block text-[14px] text-muted">{detail}</span>
        </span>
      </button>
      {checked && children ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

/** Four ticks, four dates, four amounts, and the total. */
function Schedule({ link, now }: { link: PaymentLink; now: number | null }) {
  const later = link.modes.later;
  if (!later) return null;
  return (
    <div className="border-t border-divider pt-3">
      <ol className="grid grid-cols-4 gap-2" aria-label="Payment schedule">
        {later.amounts.map((amount, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            <span aria-hidden className={cx("h-1.5 rounded-full", i === 0 ? "bg-lime" : "bg-pill")} />
            <span className="text-[12px] text-muted">
              {i === 0 ? "Today" : now ? shortDate(now + i * later.interval * 1000) : " "}
            </span>
            <span className="tabular text-[14px] font-medium">{usd(amount)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 flex justify-between text-[14px]">
        <span className="text-muted">Total, {later.aprBps / 100}% APR</span>
        <span className="tabular font-medium">{usd(later.total)}</span>
      </p>
    </div>
  );
}

function Receipt({ link, paid }: { link: PaymentLink; paid: Paid }) {
  const router = useRouter();
  const later = link.modes.later;
  const sub = link.modes.subscription;

  const headline =
    paid.mode === "later" && later
      ? `Next payment in ${describeDuration(later.interval)}.`
      : paid.mode === "subscription" && sub
        ? `Subscribed. Next charge in ${describeDuration(sub.periodSeconds)}.`
        : `${usd(link.amount)} to ${link.merchant.name}.`;

  const rows: Array<[string, ReactNode]> = [
    ["To", link.merchant.name],
    ["For", link.description],
  ];
  if (paid.mode === "later" && later) {
    rows.push(
      ["Paid today", usd(later.amounts[0] ?? 0n)],
      ["Plan", `${later.installments} × ${usd(later.amounts[0] ?? 0n)}, ${describeInterval(later.interval)}`],
      ["Total", usd(later.total)],
    );
  } else if (paid.mode === "subscription" && sub) {
    rows.push(["Paid today", usd(sub.price)], ["Then", `${usd(sub.price)} ${describeInterval(sub.periodSeconds)}`]);
  } else {
    rows.push(["Paid", usd(link.amount)]);
  }
  rows.push(["Order", link.orderId], ["Date", longDate(paid.at)]);

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

  return (
    <main id="main" className="flex min-h-dvh flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="pt-[calc(env(safe-area-inset-top)+56px)] text-center">
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-lime text-on-lime">
          <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden>
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="draw-check"
            />
          </svg>
        </span>
        <h1 className="mt-6 font-display text-[44px] leading-none font-bold tracking-[-0.05em]">Paid.</h1>
        <p className="mt-3 text-[17px]" role="status">
          {headline}
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <ReceiptRows rows={rows} />
        <InstallHint />
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <a
          href={paid.receipt.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex h-14 items-center justify-center gap-2 rounded-btn bg-surface text-[16px] font-medium"
        >
          View receipt
          <Icon name="external" size={18} />
        </a>
        <Button
          block
          onClick={() => {
            if (link.successUrl) window.location.assign(link.successUrl);
            else router.push("/");
          }}
        >
          {link.successUrl ? `Back to ${link.merchant.name}` : "Done"}
        </Button>
      </div>
    </main>
  );
}
