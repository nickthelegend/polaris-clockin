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
import { Button, Card, Skeleton, stagger, Wordmark } from "@/components/ui";
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

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <header className="flex h-16 items-center justify-between pt-[env(safe-area-inset-top)]">
        <Wordmark className="text-[26px]" />
        <HelpButton />
      </header>
      {children}
    </main>
  );
}

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
      <section className="rise relative overflow-hidden rounded-card bg-promo p-5 pb-6 text-white ring-1 ring-white/5" style={stagger(0)}>
        <p className="text-[15px] text-white/70">You&apos;ve got dollars</p>
        <p className="tabular mt-2 font-display text-[60px] leading-none font-bold tracking-[-0.05em]">
          {usd(amount, { trim: true })}
        </p>
        <p className="mt-2 text-[18px] font-medium">from {parsed.name}</p>
        <p className="mt-4 max-w-[22ch] text-[14px] text-white/70">
          Claim it with Face ID. It&apos;s yours in under a second, wherever you are.
        </p>
        <Coin size={104} className="absolute -right-3 -bottom-4 drop-shadow-[0_8px_14px_rgb(0_0_0/0.5)]" />
      </section>

      <p className="rise mt-3 text-center text-[15px]" style={stagger(1)}>
        <LocalEquivalent amount={amount} />
      </p>

      <ul className="rise mt-6 flex flex-col gap-3 px-1" style={stagger(2)}>
        {[
          { icon: "faceId" as const, text: "Face ID is your account. No password, no forms." },
          { icon: "globe" as const, text: "Hold dollars, pay with them, or send them on." },
          { icon: "bolt" as const, text: "No fees to claim." },
        ].map((p) => (
          <li key={p.text} className="flex items-center gap-3 text-[15px]">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface">
              <Icon name={p.icon} size={18} />
            </span>
            {p.text}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        {state === undefined ? (
          <Skeleton className="h-14 w-full rounded-btn" />
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
            <p className="text-[16px] font-medium">
              {state === "claimed"
                ? "This link has already been claimed."
                : state === "cancelled"
                  ? `${parsed.name} cancelled this link.`
                  : "This link has expired."}
            </p>
            <p className="mt-1 text-[14px] text-muted">
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
      <Card className="mt-6 p-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-pill">
          <Icon name="link" size={22} />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.03em]">This link isn&apos;t complete</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-[15px] text-muted">
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
    <main id="main" className="flex min-h-dvh flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="pt-[calc(env(safe-area-inset-top)+72px)] text-center">
        <span className="pop mx-auto grid size-20 place-items-center rounded-full bg-lime text-on-lime">
          <Icon name="check" size={40} strokeWidth={2.4} />
        </span>
        <h1 className="mt-6 font-display text-[44px] leading-none font-bold tracking-[-0.05em]">Arrived.</h1>
        <p className="mt-3 text-[17px]" role="status">
          {usd(amount, { trim: true })} from {name} is in your account.
        </p>
        <p className="mt-1 text-[15px]">
          <LocalEquivalent amount={amount} />
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        <a
          href={receipt.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex h-14 items-center justify-center gap-2 rounded-btn bg-surface text-[16px] font-medium"
        >
          View receipt
          <Icon name="external" size={18} />
        </a>
        <Button onClick={() => router.push("/")}>Go to your account</Button>
      </div>
    </main>
  );
}
