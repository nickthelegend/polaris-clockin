"use client";

import { useEffect, useState } from "react";
import { useBrowserValue } from "@/lib/browser";
import { Icon } from "./icon";
import { Button, Card } from "./ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * "Add to Home Screen" comes after the first payment, never before (plan
 * §5.6). Chrome gives us a real prompt; iOS Safari needs the Share sheet.
 */
export function InstallHint() {
  const standalone = useBrowserValue(isStandalone, true);
  const ios = useBrowserValue(isIos, false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone || dismissed || (!ios && !prompt)) return null;

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-chip text-lime">
        <Icon name="star" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">Keep Polaris on your home screen</p>
        <p className="text-[13px] text-muted">
          {ios ? "Tap Share, then Add to Home Screen." : "One tap, and it opens like an app."}
        </p>
      </div>
      {prompt ? (
        <Button
          size="sm"
          variant="quiet"
          icon="install"
          onClick={async () => {
            await prompt.prompt();
            setDismissed(true);
          }}
        >
          Add
        </Button>
      ) : null}
    </Card>
  );
}
