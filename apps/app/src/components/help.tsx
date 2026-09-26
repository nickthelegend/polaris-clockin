"use client";

import { useState } from "react";
import { Icon, type IconName } from "./icon";
import { Sheet } from "./sheet";
import { CircleButton } from "./ui";

const POINTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "faceId",
    title: "Your account is your Face ID",
    body: "No password, nothing to write down. Face ID opens it on your other devices that share your Apple or Google account.",
  },
  {
    icon: "plans",
    title: "Pay now, in four, or every month",
    body: "Pay in 4 shows every payment and the total interest before you confirm, and the merchant is paid in full today.",
  },
  {
    icon: "link",
    title: "Send dollars with a link",
    body: "Share it anywhere. The person who opens it gets the dollars in under a second, wherever they live.",
  },
  {
    icon: "shield",
    title: "Only you can move your money",
    body: "Every payment needs your Face ID. Polaris covers the network costs, so you only ever see dollars.",
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CircleButton icon="help" label="How Polaris works" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="How Polaris works">
        <ul className="flex flex-col gap-4">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime text-on-lime">
                <Icon name={p.icon} size={20} />
              </span>
              <span>
                <span className="block text-[16px] font-medium">{p.title}</span>
                <span className="mt-0.5 block text-[14px] text-muted">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
