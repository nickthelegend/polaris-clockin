"use client";

import { Button, EmptyState, GradientCard, ListGroup, ListRow, Money, ScreenHeader, Sheet, Skeleton } from "@polaris/ui";
import { Globe, Link2Off, ScanFace, Zap } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type Hex, isHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { LocalEquivalent } from "@/components/local-equivalent";
import { RouteSheet, useCloseSheet } from "@/components/shell/sheet-host";
import { SuccessSheet } from "@/components/success-sheet";
import { claimLink } from "@/lib/actions";
import { getSendLink } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { prefetchDomains } from "@/lib/domains";
import { type Micros, parseAmount, usd } from "@/lib/money";
import type { RelayReceipt } from "@/lib/relayer";
import { n } from "@/lib/view";

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
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
};

/** Claim (full): dollars someone sent you by link, yours with one Face ID. */
export function ClaimSheet() {
  const close = useCloseSheet();
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null,
  );
  // Parsed once: after claiming, the key is taken out of the address bar.
  const [parsed, setParsed] = useState<Parsed | null>(null);
  if (hash !== null && parsed === null) setParsed(parseFragment(hash));
  useEffect(() => prefetchDomains("send"), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Claim" onBack={close} className="-mt-2 shrink-0 px-5" />
      {parsed === null ? (
        <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-3 pt-1">
          <Skeleton shape="card" height={200} />
          <Skeleton shape="tile" height={200} />
        </Sheet.Body>
      ) : "invalid" in parsed ? (
        <Sheet.Body className="pt-6">
          <EmptyState
            icon={<Link2Off />}
            title="This link isn't complete"
            description="Part of it went missing on the way. Ask the sender to share it again, and open it straight from the message."
            action={
              <Button variant="white" size="lg" onClick={close}>
                Go to Polaris
              </Button>
            }
          />
        </Sheet.Body>
      ) : (
        <ClaimReady parsed={parsed} onDone={close} />
      )}
    </div>
  );
}

function ClaimReady({ parsed, onDone }: { parsed: { key: Hex; amount: Micros; name: string }; onDone: () => void }) {
  const linkKey = privateKeyToAddress(parsed.key);
  const status = useData(() => getSendLink(linkKey), [linkKey]);
  const [confirming, setConfirming] = useState(false);
  const [claimed, setClaimed] = useState<RelayReceipt | null>(null);
  // What the index says was escrowed wins over what the link text says.
  const amount = status.value?.amount ?? parsed.amount;
  const state = status.value?.status;

  return (
    <>
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-4 pt-1">
        <GradientCard
          tone="lime"
          label="You've got dollars"
          value={<Money value={n(amount)} dim="symbol" dimOpacity={0.4} />}
          meta={<span className="text-[16px] font-medium">from {parsed.name}</span>}
          className="min-h-[190px] pr-36"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/coin.png"
            alt=""
            width={150}
            height={150}
            className="glass-float pointer-events-none absolute top-1/2 -right-3 size-[150px] -translate-y-1/2 object-contain"
            style={{ ["--lift" as string]: "-8px", ["--turn" as string]: "8deg", ["--r" as string]: "-8deg" }}
          />
        </GradientCard>
        <LocalEquivalent amount={amount} className="-mt-1 text-center text-[14px]" />

        <ListGroup>
          <ListRow icon={<ScanFace />} title="Face ID is your account" description="No password, no forms. Or use your email." />
          <ListRow icon={<Globe />} title="Dollars, wherever you are" description="Hold them, pay with them, send them on." />
          <ListRow icon={<Zap />} title="No fees to claim" description="It lands in under a second." />
        </ListGroup>

        {state !== undefined && state !== "open" ? (
          <p role="status" className="rounded-ui-tile bg-ui-surface-2 p-4 text-center text-[15px] leading-[1.45]">
            <span className="font-medium">
              {state === "claimed"
                ? "This link has already been claimed."
                : state === "cancelled"
                  ? `${parsed.name} cancelled this link.`
                  : "This link has expired."}
            </span>{" "}
            <span className="text-ui-muted">
              {state === "claimed"
                ? "Each link pays out once. If it wasn't you, ask the sender for a new one."
                : "The money went back to the sender. Ask them for a new link."}
            </span>
          </p>
        ) : null}
      </Sheet.Body>
      <Sheet.Footer>
        {state === undefined ? (
          <Skeleton shape="pill" height={56} />
        ) : state === "open" ? (
          <Button variant="lime" size="lg" icon={<ScanFace />} onClick={() => setConfirming(true)}>
            Claim {usd(amount, { trim: true })}
          </Button>
        ) : (
          <Button variant="white" size="lg" onClick={onDone}>
            Go to Polaris
          </Button>
        )}
      </Sheet.Footer>

      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={`Claim ${usd(amount, { trim: true })}`}
        summary={`From ${parsed.name}. It lands in your account in under a second.`}
        newLabel="Claim with Face ID"
        busyLabel="Claiming…"
        onAccount={async (signer) => {
          const receipt = await claimLink(signer.address, parsed.key, amount, parsed.name);
          // The key is spent: take it out of the address bar and history.
          window.history.replaceState(window.history.state, "", "/claim");
          setClaimed(receipt);
        }}
      />
      <SuccessSheet
        open={claimed !== null}
        onOpenChange={() => onDone()}
        title="Arrived."
        subtitle={`${usd(amount, { trim: true })} from ${parsed.name} is in your account.`}
        receiptUrl={claimed?.explorerUrl}
        rows={[
          { label: "From", value: parsed.name },
          { label: "Amount", value: usd(amount) },
          { label: "Fee", value: "None" },
        ]}
        primary={{ label: "Done", onClick: onDone }}
      />
    </>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function ClaimRoute({ cold }: { cold?: boolean }) {
  return (
    <RouteSheet label="Claim your dollars" snapPoints={["full"]} cold={cold}>
      <ClaimSheet />
    </RouteSheet>
  );
}
