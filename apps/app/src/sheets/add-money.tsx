"use client";

import { DetailsList, Sheet, TileButton, toast } from "@polaris/ui";
import { ArrowDownLeft, ScanLine, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAccounts } from "@/components/accounts";
import { useAccountState } from "@/lib/account/hooks";
import { useOrigin } from "@/lib/browser";
import { usd } from "@/lib/money";
import { usePrefs } from "@/lib/prefs";
import { RouteSheet } from "@/components/shell/sheet-host";

/**
 * Add money: the ways dollars come in today, on ref C's Send / Receive /
 * Top Up tiles. Ask someone (a link to pay you), show your code, or claim a
 * link someone sent you.
 */
export function AddMoneySheet() {
  const router = useRouter();
  const state = useAccountState();
  const origin = useOrigin();
  const { name } = usePrefs();
  const { balance } = useAccounts();
  const address = state.status === "ready" || state.status === "locked" ? state.address : null;

  async function ask() {
    if (!address || !origin) {
      router.push("/onboard?next=/");
      return;
    }
    const url = `${origin}/send?${new URLSearchParams({ to: address, ...(name ? { n: name } : {}) }).toString()}`;
    const text = `Pay ${name || "me"} with Polaris. It takes a second, and there's no fee.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Pay me with Polaris", text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Send it to whoever is paying you.", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" });
    }
  }

  return (
    <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-5 pt-1">
      <div className="grid grid-cols-3 gap-2.5">
        <TileButton tone="ink" icon={<Send />} label="Ask" onClick={() => void ask()} />
        <TileButton tone="purple" icon={<ArrowDownLeft />} label="My code" onClick={() => router.push("/receive", { scroll: false })} />
        <TileButton tone="lime" icon={<ScanLine />} label="Claim" onClick={() => router.push("/pay", { scroll: false })} />
      </div>
      <p className="text-[14px] leading-[1.45] text-ui-muted">
        Ask sends a link to pay you. My code is for someone next to you. Claim opens a link someone sent you.
      </p>
      <DetailsList
        items={[
          { label: "Lands in", value: "Under a second" },
          { label: "Fee", value: "None" },
          { label: "Balance", value: balance ? usd(balance.available) : "…" },
        ]}
      />
    </Sheet.Body>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function AddMoneyRoute({ cold }: { cold?: boolean }) {
  return (
    <RouteSheet label="Add money" title="Add money" description="Dollars land in under a second" cold={cold}>
      <AddMoneySheet />
    </RouteSheet>
  );
}
