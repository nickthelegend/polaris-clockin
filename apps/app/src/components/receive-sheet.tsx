"use client";

import Link from "next/link";
import { useState } from "react";
import { useOrigin } from "@/lib/browser";
import { useAccountState } from "@/lib/account/hooks";
import { usePrefs } from "@/lib/prefs";
import { QrCode } from "./qr";
import { Sheet } from "./sheet";
import { Button, ButtonLink } from "./ui";

/**
 * Receive: a code anyone with Polaris can scan to send you dollars. It opens
 * the sender's Send screen with you filled in. Needs no Face ID: the code
 * only says where money should go.
 */
export function ReceiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAccountState();
  const { name } = usePrefs();
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  const address = state.status === "ready" || state.status === "locked" ? state.address : null;
  const params = address ? new URLSearchParams({ to: address, ...(name ? { n: name } : {}) }) : null;
  const url = params && origin ? `${origin}/send?${params.toString()}` : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Receive dollars"
      description="Show this code. Anyone with Polaris can scan it and pay you in seconds."
    >
      {url ? (
        <div className="flex flex-col items-center">
          <QrCode value={url} size={212} label="Your Polaris code for receiving dollars" className="ring-1 ring-hairline" />
          <p className="mt-4 text-[17px] font-medium">{name || "Your Polaris account"}</p>
          {!name ? (
            <Link href="/profile" className="mt-1 text-[14px] text-muted underline underline-offset-4">
              Add your name so people know it&apos;s you
            </Link>
          ) : null}
          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <Button
              variant="quiet"
              size="md"
              icon={copied ? "check" : "copy"}
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon="share"
              onClick={() => {
                if (navigator.share) {
                  void navigator.share({ title: "Pay me with Polaris", url }).catch(() => undefined);
                } else {
                  void navigator.clipboard?.writeText(url).then(() => setCopied(true));
                }
              }}
            >
              Share
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-[15px] text-muted">Create your account first. It takes one Face ID.</p>
          <ButtonLink href="/onboard?next=/" block className="mt-5" icon="faceId">
            Create your account
          </ButtonLink>
        </div>
      )}
    </Sheet>
  );
}
