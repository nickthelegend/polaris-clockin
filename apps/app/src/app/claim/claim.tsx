"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { type Hex, isHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { Coin } from "@/components/art";
import { FaceIdAction } from "@/components/face-id-action";
import { HelpButton } from "@/components/help";
import { Icon } from "@/components/icon";
import { LocalEquivalent } from "@/components/money";
import { Button, Card, cx, SCREEN_TOP, Skeleton, stagger, Wordmark } from "@/components/ui";
import { claimLink } from "@/lib/actions";
import { useAccountState } from "@/lib/account/hooks";
import { getSendLink } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { prefetchDomains } from "@/lib/domains";
import { type Micros, parseAmount, usd } from "@/lib/money";
import type { RelayReceipt } from "@/lib/relayer";

type Parsed = { key: Hex; amount: Micros; name: string } | { invalid: true };

/**
 * The link is `/claim#k=<key>&a=<amount>&n=<name>`. The fragment never leaves
 * the browser: it is not sent with the request, not logged, and not passed to
 * any API. Only the key's public address and a signature made with it are.
 */
function parseFragment(hash: string): Parsed {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const key = params.get("k") ?? "";
  const amount = parseAmount(params.get("a") ?? "");
  // Display text from a link: strip control characters, cap the length.
  const name = (params.get("n") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!isHex(key) || key.length !== 66 || amount === null || amount <= 0n) return { invalid: true };
  return { key, amount, name: name || "Someone" };
}

const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function Claim() {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null,
  );
  const [claimed, setClaimed] = useState<{ receipt: RelayReceipt; amount: Micros; name: string } | null>(null);

  useEffect(() => prefetchDomains("send"), []);

  if (claimed) return <Arrived {...claimed} />;
  if (hash === null) {
    return (
      <Frame>
        <Skeleton className="h-[220px] w-full rounded-card" />
      </Frame>
    );
  }
  const parsed = parseFragment(hash);
  if ("invalid" in parsed) return <BrokenLink />;
  return <ClaimReady parsed={parsed} onClaimed={setClaimed} />;
}

/** The Home header (wordmark and help), over whatever the link holds. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className={cx("flex min-h-dvh flex-col px-[15px] pb-[calc(20.5px+env(safe-area-inset-bottom))]", SCREEN_TOP)}
    >
      <header className="flex h-[41px] items-center justify-between">
        <Wordmark />
        <HelpButton />
      </header>
      {children}
    </main>
  );
}

const POINTS = [
  { icon: "faceId" as const, title: "Face ID is your account", meta: "No password, no forms" },
  { icon: "globe" as const, title: "Dollars, wherever you are", meta: "Hold them, pay with them, send them on" },
  { icon: "bolt" as const, title: "No fees to claim", meta: "It lands in under a second" },
];

function ClaimReady({
  parsed,
  onClaimed,
}: {
  parsed: { key: Hex; amount: Micros; name: string };
  onClaimed: (value: { receipt: RelayReceipt; amount: Micros; name: string }) => void;
}) {
  const account = useAccountState();
  const linkKey = privateKeyToAddress(parsed.key);
  const status = useData(() => getSendLink(linkKey), [linkKey]);
  // What the index says was escrowed wins over what the link text says.
  const amount = status.value?.amount ?? parsed.amount;
  const state = status.value?.status;

  return (
    <Frame>
      <section
        className="rise relative mt-[21px] flex min-h-[176px] items-center overflow-hidden rounded-card bg-promo py-5 pr-[10px] pl-[16.5px] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.75)]"
        style={stagger(0)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] tracking-[-0.02em] text-[#a6a6a6]">You&apos;ve got dollars</p>
          <p className="mt-1.5 font-display text-[52px] leading-none font-medium tracking-[-0.01em]">
            {usd(amount, { trim: true })}
          </p>
          <p className="mt-2 text-[16px] font-medium tracking-[-0.03em]">from {parsed.name}</p>
          <p className="mt-1 max-w-[210px] text-[13px] leading-[19px] tracking-[-0.015em] text-[#a6a6a6]">
            Claim it with Face ID. It&apos;s yours in under a second, wherever you are.
          </p>
        </div>
        <Coin size={112} className="-mr-2 shrink-0" />
      </section>

      <p className="rise mt-2.5 h-5 text-center text-[14px]" style={stagger(1)}>
        <LocalEquivalent amount={amount} />
      </p>

      <Card className="rise mt-[3.5px] px-4 py-[7.25px]" style={stagger(2)}>
        <ul>
          {POINTS.map((p) => (
            <li key={p.title} className="flex h-[70.5px] items-center gap-[14.5px]">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-well text-[#77797c]">
                <Icon name={p.icon} size={26} strokeWidth={1.5} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{p.title}</span>
                <span className="mt-[3px] block text-[14px] leading-[18px] tracking-[-0.02em] text-meta">{p.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-auto pt-8">
        {state === undefined ? (
          <Skeleton className="h-[54px] w-full rounded-btn" />
        ) : state === "open" ? (
          <FaceIdAction
            label="Claim with Face ID"
            newLabel="Claim with Face ID"
            busyLabel="Claiming…"
            hint={account.status === "none" ? "Face ID creates your Polaris account and claims the dollars, in one go." : undefined}
            onAccount={async (signer) => {
              const receipt = await claimLink(signer.address, parsed.key, amount, parsed.name);
              // The key is spent: take it out of the address bar and history.
              window.history.replaceState(null, "", "/claim");
              onClaimed({ receipt, amount, name: parsed.name });
            }}
          />
        ) : (
          <Card className="p-4 text-center" role="status">
            <p className="text-[16px] font-medium tracking-[-0.03em]">
              {state === "claimed"
                ? "This link has already been claimed."
                : state === "cancelled"
                  ? `${parsed.name} cancelled this link.`
                  : "This link has expired."}
            </p>
            <p className="mt-1 text-[14px] tracking-[-0.02em] text-meta">
              {state === "claimed"
                ? "Each link pays out once. If it wasn't you, ask the sender for a new one."
                : "The money went back to the sender. Ask them for a new link."}
            </p>
          </Card>
        )}
      </div>
    </Frame>
  );
}

function BrokenLink() {
  const router = useRouter();
  return (
    <Frame>
      <Card className="mt-[21px] px-5 pt-6 pb-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-well text-[#77797c]">
          <Icon name="link" size={26} strokeWidth={1.5} />
        </span>
        <h1 className="mt-4 text-[18px] font-medium tracking-[-0.04em]">This link isn&apos;t complete</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-[14px] tracking-[-0.02em] text-meta">
          Part of it went missing on the way. Ask the sender to share it again, and open it straight from the message.
        </p>
      </Card>
      <div className="mt-auto pt-8">
        <Button block variant="secondary" onClick={() => router.push("/")}>
          Go to Polaris
        </Button>
      </div>
    </Frame>
  );
}

function Arrived({ receipt, amount, name }: { receipt: RelayReceipt; amount: Micros; name: string }) {
  const router = useRouter();
  return (
    <main id="main" className="flex min-h-dvh flex-col px-[15px] pb-[calc(20.5px+env(safe-area-inset-bottom))]">
      <div className={cx("text-center", SCREEN_TOP)}>
        <span className="block h-[72px]" aria-hidden />
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-lime text-on-lime">
          <Icon name="check" size={40} strokeWidth={2.4} />
        </span>
        <h1 className="mt-6 font-display text-[44px] leading-none font-semibold tracking-[-0.05em]">Arrived.</h1>
        <p className="mt-3 text-[16px] tracking-[-0.02em]" role="status">
          {usd(amount, { trim: true })} from {name} is in your account.
        </p>
        <p className="mt-1 text-[15px]">
          <LocalEquivalent amount={amount} />
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-[13.5px] pt-8">
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex h-[54px] items-center justify-center gap-2 rounded-full bg-surface text-[16px] tracking-[-0.03em] shadow-surface"
          >
            View receipt
            <Icon name="external" size={18} />
          </a>
        ) : null}
        <Button onClick={() => router.push("/")}>Go to your account</Button>
      </div>
    </main>
  );
}
