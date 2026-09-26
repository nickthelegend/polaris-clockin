"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Button, Card, CardTitle, ScreenHeader, Skeleton } from "@/components/ui";
import { getPaymentLink, type PaymentLink, SAMPLE_LINK_IDS } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { toAppPath } from "@/lib/links";
import { usd } from "@/lib/money";

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const detectorCtor = (): DetectorCtor | null =>
  typeof window !== "undefined" && "BarcodeDetector" in window
    ? (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector
    : null;

/** Whether this browser can read QR codes from the camera (Chrome on Android can; Safari can't). */
function useCanScan(): boolean | null {
  return useSyncExternalStore(
    () => () => undefined,
    () => detectorCtor() !== null && !!navigator.mediaDevices?.getUserMedia,
    () => null,
  );
}

/** Pay: scan a Polaris code, paste a link, or try a sample. */
export function Scan() {
  const router = useRouter();
  const canScan = useCanScan();
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const open = useCallback(
    (value: string) => {
      const path = toAppPath(value, window.location.origin);
      if (!path) {
        setMessage("That isn't a Polaris link. Check it and try again.");
        return false;
      }
      router.push(path);
      return true;
    },
    [router],
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setMessage(null);
    const Ctor = detectorCtor();
    if (!Ctor) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["qr_code"] });
      const loop = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes[0]?.rawValue;
          if (hit) {
            if (open(hit)) {
              stop();
              return;
            }
          }
        } catch {
          /* keep looking */
        }
        setTimeout(() => void loop(), 250);
      };
      void loop();
    } catch {
      setMessage("Polaris needs your camera to scan. You can paste the link instead.");
      stop();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    open(text);
  }

  return (
    <main id="main" className="px-[15px] pb-[calc(32px+env(safe-area-inset-bottom))]">
      <ScreenHeader title="Pay" back="/" />

      {/* Viewfinder */}
      <div className="relative mx-auto mt-[21px] aspect-square w-full overflow-hidden rounded-card bg-ink-card shadow-[0_0_0_1px_rgb(255_255_255/0.75)]">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={scanning ? "absolute inset-0 size-full object-cover" : "hidden"}
        />
        <Corners />
        {!scanning ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center text-white">
            <span className="grid size-14 place-items-center rounded-full bg-lime text-on-lime">
              <Icon name="scan" size={28} strokeWidth={2} />
            </span>
            {canScan === null ? null : canScan ? (
              <>
                <p className="max-w-[24ch] text-[16px] tracking-[-0.02em] text-[#a6a6a6]">Point your camera at a Polaris code to pay or claim.</p>
                <Button variant="lime" size="md" icon="scan" onClick={() => void start()}>
                  Scan a code
                </Button>
              </>
            ) : (
              <p className="max-w-[26ch] text-[16px] tracking-[-0.02em] text-[#a6a6a6]">
                Open your phone&apos;s camera and point it at the code. It brings you straight here.
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="press absolute bottom-4 left-1/2 flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-4 text-[14px] font-medium text-white backdrop-blur"
          >
            <Icon name="close" size={16} />
            Stop
          </button>
        )}
      </div>

      {/* Paste */}
      <form onSubmit={submit} className="mt-[13.5px] flex gap-[8.5px]">
        <label htmlFor="link" className="sr-only">
          Payment or claim link
        </label>
        <input
          id="link"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste a Polaris link"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-[54px] min-w-0 flex-1 rounded-full bg-surface px-5 text-[16px] tracking-[-0.02em] shadow-surface placeholder:text-muted focus-visible:outline-2"
        />
        {text ? (
          <Button type="submit" size="lg" className="w-auto px-5">
            Open
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            icon="paste"
            className="w-auto px-5"
            onClick={async () => {
              try {
                const clip = await navigator.clipboard.readText();
                setText(clip);
                open(clip);
              } catch {
                setMessage("Paste the link into the box.");
              }
            }}
          >
            Paste
          </Button>
        )}
      </form>
      {message ? (
        <p role="alert" className="mt-3 text-center text-[14px] text-negative">
          {message}
        </p>
      ) : null}

      <SampleLinks />
    </main>
  );
}

function Corners() {
  const corner = "absolute size-10 border-lime";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-8">
      <span className={`${corner} top-0 left-0 rounded-tl-[18px] border-t-[3px] border-l-[3px]`} />
      <span className={`${corner} top-0 right-0 rounded-tr-[18px] border-t-[3px] border-r-[3px]`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-[18px] border-b-[3px] border-l-[3px]`} />
      <span className={`${corner} right-0 bottom-0 rounded-br-[18px] border-r-[3px] border-b-[3px]`} />
    </div>
  );
}

/** Placeholder merchants' links, so every checkout path can be tried. */
function SampleLinks() {
  const links = useData(
    async () => (await Promise.all(SAMPLE_LINK_IDS.map((id) => getPaymentLink(id)))).filter((l): l is PaymentLink => l !== null),
    [],
  );
  return (
    <Card className="mt-[13.5px] px-4 pt-4 pb-2">
      <CardTitle>Try a sample link</CardTitle>
      <ul className="mt-[7.25px]">
        {links.value
          ? links.value.map((link) => (
              <li key={link.id}>
                <Link
                  href={`/pay/${link.id}`}
                  className="press -mx-2 flex h-[70.5px] items-center gap-[14.5px] rounded-[18px] px-2 hover:bg-fg/[0.025]"
                >
                  <Avatar name={link.merchant.name} kind="merchant" icon="store" size={56} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] leading-[22px] font-medium tracking-[-0.03em]">{link.merchant.name}</span>
                    <span className="mt-[3px] block truncate text-[14px] leading-[18px] tracking-[-0.02em] text-meta">
                      {link.description}
                      {link.modes.later ? " · Pay in 4" : ""}
                      {link.modes.subscription ? " · Subscribe" : ""}
                    </span>
                  </span>
                  <span className="text-[16px] font-medium tracking-[-0.03em]">{usd(link.amount, { trim: true })}</span>
                </Link>
              </li>
            ))
          : Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <Skeleton className="size-11 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </li>
            ))}
      </ul>
    </Card>
  );
}
