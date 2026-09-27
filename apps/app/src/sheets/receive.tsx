"use client";

import { Button, IconButton, Input, Sheet, toast } from "@polaris/ui";
import { Copy, ScanFace, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { QrCode } from "@/components/qr";
import { useAccountState } from "@/lib/account/hooks";
import { useOrigin } from "@/lib/browser";
import { usePrefs } from "@/lib/prefs";
import { RouteSheet } from "@/components/shell/sheet-host";

/**
 * Receive: a code anyone with Polaris can scan to send you dollars. It opens
 * the sender's Send sheet with you filled in. No Face ID needed: the code only
 * says where money should go.
 */
export function ReceiveSheet() {
  const state = useAccountState();
  const router = useRouter();
  const { name } = usePrefs();
  const origin = useOrigin();

  const address = state.status === "ready" || state.status === "locked" ? state.address : null;
  const params = address ? new URLSearchParams({ to: address, ...(name ? { n: name } : {}) }) : null;
  const url = params && origin ? `${origin}/send?${params.toString()}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" });
    }
  }

  if (!url) {
    return (
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 items-center gap-4 pt-4 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-ui-surface-2">
          <ScanFace aria-hidden size={30} strokeWidth={1.5} />
        </span>
        <p className="max-w-[30ch] text-[15px] leading-[1.45] text-ui-muted">
          Your code needs an account first. It takes one Face ID.
        </p>
        <Button variant="lime" size="lg" block onClick={() => router.push("/onboard?next=/")}>
          Create your account
        </Button>
      </Sheet.Body>
    );
  }

  return (
    <Sheet.Body className="flex flex-col [&>*]:shrink-0 items-center gap-4 pt-1">
      <QrCode value={url} size={168} label="Your Polaris code for receiving dollars" />
      <p className="text-center text-[15px] leading-[1.45] text-ui-muted">
        {name ? (
          <>
            <span className="font-medium text-ui-text">{name}</span>. Anyone with Polaris can scan this and pay you.
          </>
        ) : (
          "Anyone with Polaris can scan this and pay you in seconds."
        )}
      </p>
      <div className="flex w-full items-end gap-2">
        <Input hideLabel label="Your link" readOnly value={url.replace(/^https?:\/\//, "")} wrapperClassName="min-w-0 flex-1" />
        <IconButton label="Copy link" icon={<Copy />} tone="lime" size="lg" onClick={() => void copy()} />
      </div>
      <Button
        variant="white"
        size="lg"
        block
        icon={<Share2 />}
        onClick={() => {
          if (navigator.share) void navigator.share({ title: "Pay me with Polaris", url }).catch(() => undefined);
          else void copy();
        }}
      >
        Share
      </Button>
    </Sheet.Body>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function ReceiveRoute({ cold }: { cold?: boolean }) {
  return (
    <RouteSheet label="Receive" title="Receive" description="Your code for getting paid" cold={cold}>
      <ReceiveSheet />
    </RouteSheet>
  );
}
