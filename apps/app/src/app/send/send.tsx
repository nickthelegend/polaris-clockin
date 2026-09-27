"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { CardThumb, Coin } from "@/components/art";
import { Avatar } from "@/components/avatar";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { Keypad } from "@/components/keypad";
import { LocalEquivalent } from "@/components/money";
import { ChangePill, PartyCard, PartyRow } from "@/components/party";
import { QrCode } from "@/components/qr";
import { Sheet } from "@/components/sheet";
import { Button, Card, cx, SCREEN_TOP, ScreenHeader } from "@/components/ui";
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

const SCREEN = "flex min-h-dvh flex-col px-[15px] pb-[calc(20.5px+env(safe-area-inset-bottom))]";

/** Send money, laid out on the reference's third screen. */
export function Send() {
  const params = useSearchParams();
  const router = useRouter();
  const account = useAccountState();
  const owner = account.status === "ready" || account.status === "locked" ? account.address : null;
  const balance = useData(() => getBalance(owner), [owner]);
  const contacts = useData(() => getContacts(owner), [owner]);
  const profile = useData(() => getProfile(owner), [owner]);
  const prefs = usePrefs();
  const [value, setValue] = useState("0");
  const [picking, setPicking] = useState(false);
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

  const change = <ChangePill onClick={() => setPicking(true)} label="Change who you're sending to" />;

  return (
    <main id="main" className={SCREEN}>
      <ScreenHeader title="Send money" back="/" right={<HelpButton />} />

      {/* Send to */}
      <PartyCard label="Send to" className="mt-[21px]">
        {recipient.kind === "link" ? (
          <PartyRow
            avatar={<Avatar name="Link" kind="polaris" icon="link" size={57.5} />}
            name="Anyone with the link"
            meta="They claim it with Face ID, anywhere"
            action={change}
          />
        ) : (
          <PartyRow
            avatar={
              <Avatar
                name={recipient.person.name}
                country={recipient.kind === "contact" ? recipient.person.country : undefined}
                photo={recipient.kind === "contact"}
                size={57.5}
              />
            }
            name={recipient.person.name}
            meta={recipient.kind === "contact" ? recipient.person.handle : "Polaris account"}
            action={change}
          />
        )}
      </PartyCard>

      {/* Amount */}
      <section className="relative flex flex-1 items-center justify-center py-6" aria-live="polite">
        <p className="sr-only">Amount: {usd(amount, { trim: true })}</p>
        <p aria-hidden className="flex items-center font-display text-[62px] leading-none font-medium tracking-[-0.005em]">
          ${Number(value).toLocaleString("en-US")}
          <span className="amount-cursor ml-[8px] inline-block h-[67px] w-[3px] rounded-full bg-lime" />
        </p>
        <p className={cx("absolute inset-x-0 bottom-3 text-center text-[14px]", tooMuch && "text-negative")}>
          {tooMuch ? "That's more than your balance" : amount > 0n ? <LocalEquivalent amount={amount} /> : null}
        </p>
      </section>

      {/* From */}
      <Card className="flex h-[76.5px] items-center gap-[14.5px] px-[16.5px]">
        <CardThumb />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">Dollar account</p>
          <p className="mt-[2px] truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">
            Balance <span className="text-fg">{available !== undefined ? usd(available) : "…"}</span>
          </p>
        </div>
        <ChangePill href="/cards" label="Change the account you send from" />
      </Card>

      <div className="mt-[13.5px]">
        <Keypad value={value} onChange={setValue} />
      </div>

      <div className="mt-[13.5px]">
        <FaceIdAction
          icon={false}
          label="Send money"
          newLabel="Send money"
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

      <Sheet open={picking} onClose={() => setPicking(false)} title="Send to">
        <ul className="-mx-2 flex flex-col">
          <li>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                router.replace("/send");
              }}
              className="press flex w-full items-center gap-[14.5px] rounded-[18px] px-2 py-2 text-left hover:bg-fg/[0.03]"
            >
              <Avatar name="Link" kind="polaris" icon="link" size={48} />
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium tracking-[-0.03em]">Anyone with a link</span>
                <span className="block text-[14px] text-meta">Share it anywhere; they claim it with Face ID</span>
              </span>
              {recipient.kind === "link" ? <Icon name="check" size={18} strokeWidth={2.2} /> : null}
            </button>
          </li>
          {(contacts.value ?? []).map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  setPicking(false);
                  router.replace(`/send?contact=${person.id}`);
                }}
                className="press flex w-full items-center gap-[14.5px] rounded-[18px] px-2 py-2 text-left hover:bg-fg/[0.03]"
              >
                <Avatar name={person.name} country={person.country} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium tracking-[-0.03em]">{person.name}</span>
                  <span className="block truncate text-[14px] text-meta">{person.handle}</span>
                </span>
                {recipient.kind === "contact" && recipient.person.id === person.id ? (
                  <Icon name="check" size={18} strokeWidth={2.2} />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
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
    <main id="main" className={SCREEN}>
      <ScreenHeader title="Send money" back="/" right={<HelpButton />} />

      <section className="rise relative mt-[21px] flex min-h-[122px] items-center overflow-hidden rounded-card bg-promo py-4 pr-[14px] pl-[16.5px] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.75)]">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] tracking-[-0.02em] text-[#a6a6a6]">{who ? `Your link for ${who}` : "Your link is ready"}</p>
          <p className="mt-1 font-display text-[44px] leading-none font-semibold tracking-[-0.04em]">
            {usd(link.amount, { trim: true })}
          </p>
          <p className="mt-2 max-w-[236px] text-[13px] leading-[19px] tracking-[-0.015em] text-[#a6a6a6]">
            Whoever opens it gets the dollars. Share it only with {who ?? "the person it's for"}.
          </p>
        </div>
        <Coin size={68} className="shrink-0" />
      </section>

      <Card className="mt-[13.5px] flex flex-col items-center px-4 pt-5 pb-4">
        <QrCode value={link.url} size={172} label="QR code of your send link" className="p-2" />
        <div className="mt-3 flex items-center justify-center gap-2 text-[15px] tracking-[-0.02em]" role="status" aria-live="polite">
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
      </Card>

      <div className="mt-auto flex flex-col gap-[13.5px] pt-8">
        {state === "open" ? (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-[8.5px]">
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
    <main id="main" className={SCREEN}>
      <div className={cx("text-center", SCREEN_TOP)}>
        <span className="block h-[72px]" aria-hidden />
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-lime text-on-lime">
          <Icon name="check" size={40} strokeWidth={2.4} />
        </span>
        <h1 className="mt-6 font-display text-[44px] leading-none font-semibold tracking-[-0.05em]">Sent.</h1>
        <p className="mt-3 text-[16px] tracking-[-0.02em]" role="status">
          {usd(sent.amount, { trim: true })} is in {sent.to.name}&apos;s account.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-[13.5px] pt-8">
        {sent.receipt.explorerUrl ? (
          <a
            href={sent.receipt.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex h-[54px] items-center justify-center gap-2 rounded-full bg-surface text-[16px] font-medium tracking-[-0.02em] shadow-surface"
          >
            View receipt
            <Icon name="external" size={18} />
          </a>
        ) : null}
        <Button onClick={() => router.push("/")}>Done</Button>
      </div>
    </main>
  );
}
