"use client";

import { useState } from "react";
import { useHref } from "@/lib/browser";
import { Icon } from "./icon";
import { QrCode } from "./qr";
import { Button, Card } from "./ui";

type Reason = "no-webauthn" | "no-prf" | "insecure" | "host" | "unsupported" | "in-app";

const COPY: Record<Reason, { title: string; body: string }> = {
  "no-webauthn": {
    title: "Open Polaris on your phone",
    body: "This browser can't hold a Polaris account. Scan the code with your phone's camera and carry on there, with Face ID.",
  },
  "no-prf": {
    title: "Open Polaris on your phone",
    body: "This browser can't hold a Polaris account. Scan the code with your phone's camera and carry on there, with Face ID.",
  },
  unsupported: {
    title: "Open Polaris on your phone",
    body: "Face ID worked, but this browser can't keep a Polaris account. Scan the code with your phone and carry on there.",
  },
  insecure: {
    title: "Open this page securely",
    body: "Face ID only works on a secure (https) page. Open the secure page, or scan the code with your phone.",
  },
  host: {
    title: "Open Polaris on your phone",
    body: "Polaris accounts don't work on this site. Scan the code, or open polarispay.app.",
  },
  "in-app": {
    title: "Open in Safari or Chrome",
    body: "This app's built-in browser can't use Face ID for Polaris. Tap ··· and choose Open in browser, or copy the link.",
  },
};

/** The friendly dead end: the same page, on a device that can hold an account. */
export function OpenOnPhone({ reason = "no-webauthn" }: { reason?: Reason }) {
  const href = useHref();
  const [copied, setCopied] = useState(false);
  const copy = COPY[reason];

  return (
    <Card className="p-5 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-pill text-fg">
        <Icon name="phone" size={24} />
      </span>
      <h2 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.03em]">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-[32ch] text-[15px] text-muted">{copy.body}</p>
      {href && reason !== "in-app" ? (
        <div className="mt-5 flex justify-center">
          <QrCode value={href} size={184} label="QR code that opens this page on your phone" />
        </div>
      ) : null}
      {href ? (
        <Button
          variant="quiet"
          size="md"
          icon={copied ? "check" : "copy"}
          className="mt-5"
          onClick={() => {
            void navigator.clipboard?.writeText(href).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </Button>
      ) : null}
      <p className="mt-4 text-[13px] text-muted">Works on iPhone (iOS 18+) and Android with Chrome.</p>
    </Card>
  );
}
