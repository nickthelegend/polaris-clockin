"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { Coin, MiniCard } from "@/components/art";
import { Avatar } from "@/components/avatar";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { Keypad } from "@/components/keypad";
import { LocalEquivalent } from "@/components/money";
import { QrCode } from "@/components/qr";
import { Button, Card, cx, ScreenHeader } from "@/components/ui";
import { type CreatedSendLink, cancelSendLink, createSendLink, transferTo } from "@/lib/actions";
import { useAccountState } from "@/lib/account/hooks";
import { getBalance, getContacts, getProfile, getSendLink, type Person } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { longDate } from "@/lib/dates";
import { prefetchDomains } from "@/lib/domains";
import { parseAmount, usd } from "@/lib/money";
import { usePrefs } from "@/lib/prefs";
import type { RelayReceipt } from "@/lib/relayer";

type Recipient =
  | { kind: "link" }
  | { kind: "contact"; person: Person }
  | { kind: "account"; person: Person & { address: `0x${string}` } };

export function Send() {
  const params = useSearchParams();
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const contacts = useData(() => getContacts(owner), [owner]);
  const profile = useData(() => getProfile(owner), [owner]);
  const prefs = usePrefs();
  const [value, setValue] = useState("0");
  const [link, setLink] = useState<CreatedSendLink | null>(null);
  const [sent, setSent] = useState<{ receipt: RelayReceipt; amount: bigint; to: Person } | null>(null);

  useEffect(() => prefetchDomains("ausd", "send"), []);

  // Who the money is for: a Receive code (?to=), a saved contact (?contact=), or anyone with a link.
  const to = params.get("to");
  const contactId = params.get("contact");
  let recipient: Recipient = { kind: "link" };
  if (to && isAddress(to)) {
    const name = (params.get("n") ?? "").slice(0, 40).trim();
    recipient = {
      kind: "account",
      person: { id: to, name: name || "Polaris account", country: "US", handle: "Polaris account", address: getAddress(to) },
    };
  } else if (contactId) {
    const person = contacts.value?.find((p) => p.id === contactId);
    if (person) recipient = { kind: "contact", person };
  }

  const amount = parseAmount(value) ?? 0n;
  const available = balance.value?.available;
  const tooMuch = available !== undefined && account.status !== "none" && amount > available;
  const senderName = prefs.name || profile.value?.name || "";

  if (sent) return <Sent sent={sent} />;
  if (link) return <LinkReady link={link} recipient={recipient} senderName={senderName} />;

  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(16px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="Send money" back="/" right={<HelpButton />} />

      {/* Send to */}
      <Card className="p-4">
        <p className="text-[15px] text-muted">Send to</p>
        <div className="mt-3 flex items-center gap-3 border-t border-divider pt-3">
          {recipient.kind === "link" ? (
            <>
              <Avatar name="Link" kind="polaris" icon="link" size={52} />
              <div className="min-w-0 flex-1">
                <p className="text-[17px] font-medium">Anyone with the link</p>
                <p className="truncate text-[14px] text-muted">They claim it with Face ID, anywhere</p>
              </div>
            </>
          ) : (
            <>
              <Avatar
                name={recipient.person.name}
                country={recipient.kind === "contact" ? recipient.person.country : undefined}
                size={52}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-medium">{recipient.person.name}</p>
                <p className="truncate text-[14px] text-muted">
                  {recipient.kind === "contact" ? `${recipient.person.handle} · by link` : "Polaris account"}
                </p>
              </div>
              <Link href="/send" replace className="press inline-flex h-8 items-center rounded-full bg-pill px-3.5 text-[14px]">
                Change
              </Link>
            </>
          )}
        </div>
      </Card>

      {/* Amount */}
      <section className="flex flex-1 flex-col items-center justify-center py-6" aria-live="polite">
        <p className="sr-only">Amount: {usd(amount, { trim: true })}</p>
        <p aria-hidden className="tabular flex items-center font-display text-[64px] leading-none font-bold tracking-[-0.05em]">
          ${Number(value).toLocaleString("en-US")}
          <span className="amount-cursor ml-1 inline-block h-[56px] w-[3px] rounded-full bg-lime" />
        </p>
        <p className={cx("mt-2 h-5 text-[15px]", tooMuch && "text-negative")}>
          {tooMuch ? "That's more than your balance" : amount > 0n ? <LocalEquivalent amount={amount} /> : null}
        </p>
      </section>

      {/* From */}
      <Card className="mb-3 flex items-center gap-3 p-4">
        <MiniCard className="h-9 w-14" />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-medium">Dollar account</p>
          <p className="tabular text-[14px] text-muted">
            Balance {available !== undefined ? usd(available) : "…"}
          </p>
        </div>
        {senderName && recipient.kind !== "account" ? (
          <Link href="/profile" className="max-w-[40%] truncate text-right text-[13px] text-muted">
            From <span className="font-medium text-fg">{senderName}</span>
          </Link>
        ) : null}
      </Card>

      <Keypad value={value} onChange={setValue} />

      <div className="mt-3">
        <FaceIdAction
          label={recipient.kind === "account" ? `Send ${usd(amount, { trim: true })}` : "Create link"}
          newLabel={recipient.kind === "account" ? `Send ${usd(amount, { trim: true })}` : "Create link"}
          busyLabel={recipient.kind === "account" ? "Sending…" : "Making your link…"}
          disabled={amount === 0n || tooMuch}
          onAccount={async (signer) => {
            if (recipient.kind === "account") {
              const receipt = await transferTo(signer, recipient.person, amount);
              setSent({ receipt, amount, to: recipient.person });
            } else {
              const created = await createSendLink(signer, amount, senderName || "A friend", window.location.origin);
              setLink(created);
            }
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    </main>
  );
}

function LinkReady({ link, recipient, senderName }: { link: CreatedSendLink; recipient: Recipient; senderName: string }) {
  const router = useRouter();
  const status = useData(() => getSendLink(link.linkKey), [link.linkKey]);
  const [copied, setCopied] = useState(false);
  const who = recipient.kind === "contact" ? recipient.person.name.split(" ")[0] : null;
  const state = status.value?.status ?? "open";

  async function share() {
    const text = `${usd(link.amount, { trim: true })} from ${senderName || "a friend"}. Open the link to claim it.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Polaris", text, url: link.url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(16px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="Send money" back="/" right={<HelpButton />} />

      <section className="rise relative overflow-hidden rounded-card bg-promo p-5 text-white ring-1 ring-white/5">
        <p className="text-[15px] text-white/70">{who ? `Your link for ${who}` : "Your link is ready"}</p>
        <p className="tabular mt-1 font-display text-[52px] leading-none font-bold tracking-[-0.05em]">
          {usd(link.amount, { trim: true })}
        </p>
        <p className="mt-3 max-w-[24ch] text-[14px] text-white/70">
          Whoever opens it gets the dollars. Share it only with {who ?? "the person it's for"}.
        </p>
        <Coin size={92} className="absolute -right-2 -bottom-3 drop-shadow-[0_8px_14px_rgb(0_0_0/0.5)]" />
      </section>

      <div className="mt-5 flex justify-center">
        <QrCode value={link.url} size={176} label="QR code of your send link" className="ring-1 ring-hairline" />
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-[15px]" role="status" aria-live="polite">
        {state === "open" ? (
          <>
            <span className="pulse-dot size-2.5 rounded-full bg-lime text-lime" aria-hidden />
            <span className="font-medium">Waiting to be claimed</span>
            <span className="text-muted">· until {longDate(link.expiresAt)}</span>
          </>
        ) : state === "claimed" ? (
          <>
            <Icon name="check" size={18} className="text-positive" />
            <span className="font-medium">Claimed. It arrived.</span>
          </>
        ) : (
          <>
            <Icon name="receive" size={18} />
            <span className="font-medium">Cancelled. The money is back in your account.</span>
          </>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        {state === "open" ? (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Button icon="share" onClick={() => void share()}>
                Share link
              </Button>
              <Button variant="secondary" icon={copied ? "check" : "copy"} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <FaceIdAction
              variant="quiet"
              label="Cancel link"
              busyLabel="Cancelling…"
              onAccount={async (signer) => {
                await cancelSendLink(signer, link.linkKey);
              }}
            />
          </>
        ) : null}
        <Button variant={state === "open" ? "secondary" : "primary"} onClick={() => router.push("/")}>
          Done
        </Button>
      </div>
    </main>
  );
}

function Sent({ sent }: { sent: { receipt: RelayReceipt; amount: bigint; to: Person } }) {
  const router = useRouter();
  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="pt-[calc(env(safe-area-inset-top)+72px)] text-center">
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-lime text-on-lime">
          <Icon name="check" size={40} strokeWidth={2.4} />
        </span>
        <h1 className="mt-6 font-display text-[44px] leading-none font-bold tracking-[-0.05em]">Sent.</h1>
        <p className="mt-3 text-[17px]" role="status">
          {usd(sent.amount, { trim: true })} is in {sent.to.name}&apos;s account.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        <a
          href={sent.receipt.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex h-14 items-center justify-center gap-2 rounded-btn bg-surface text-[16px] font-medium"
        >
          View receipt
          <Icon name="external" size={18} />
        </a>
        <Button onClick={() => router.push("/")}>Done</Button>
      </div>
    </main>
  );
}
