"use client";

import { AssetRow, Button, Input, ScreenHeader, SectionHeader, Sheet, Skeleton } from "@polaris/ui";
import { ClipboardPaste, ScanLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MerchantAvatar } from "@/components/avatars";
import { RouteSheet, useCloseSheet } from "@/components/shell/sheet-host";
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

/** Pay or claim a link (full): scan a Polaris code, paste a link, or try a sample. */
export function PaySheet() {
  const router = useRouter();
  const close = useCloseSheet();
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
      router.push(path, { scroll: false });
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
          const hit = (await detector.detect(video))[0]?.rawValue;
          if (hit && open(hit)) {
            stop();
            return;
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

  const corner = "absolute size-10 border-ui-lime";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Pay or claim" onBack={close} className="-mt-2 shrink-0 px-5" />
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 gap-4 pt-1">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-ui-card bg-ui-candle-panel">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Camera preview"
            className={scanning ? "absolute inset-0 size-full object-cover" : "hidden"}
          />
          <div aria-hidden className="pointer-events-none absolute inset-7">
            <span className={`${corner} top-0 left-0 rounded-tl-[18px] border-t-[3px] border-l-[3px]`} />
            <span className={`${corner} top-0 right-0 rounded-tr-[18px] border-t-[3px] border-r-[3px]`} />
            <span className={`${corner} bottom-0 left-0 rounded-bl-[18px] border-b-[3px] border-l-[3px]`} />
            <span className={`${corner} right-0 bottom-0 rounded-br-[18px] border-r-[3px] border-b-[3px]`} />
          </div>
          {!scanning ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
              {canScan === null ? null : canScan ? (
                <>
                  <p className="max-w-[26ch] text-[15px] text-ui-muted">Point your camera at a Polaris code to pay or claim.</p>
                  <Button variant="lime" size="md" icon={<ScanLine />} onClick={() => void start()}>
                    Scan a code
                  </Button>
                </>
              ) : (
                <p className="max-w-[28ch] text-[15px] leading-[1.45] text-ui-muted">
                  Open your phone&apos;s camera and point it at the code. It brings you straight here.
                </p>
              )}
            </div>
          ) : (
            <Button variant="dark" size="sm" icon={<X />} onClick={stop} className="absolute bottom-4 left-1/2 -translate-x-1/2">
              Stop
            </Button>
          )}
        </div>

        <form onSubmit={submit} className="flex items-end gap-2">
          <Input
            hideLabel
            label="Payment or claim link"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste a Polaris link"
            value={text}
            onChange={(e) => setText(e.target.value)}
            wrapperClassName="min-w-0 flex-1"
            error={message ?? undefined}
          />
          {text ? (
            <Button type="submit" variant="lime" size="lg" className="h-12 px-5">
              Open
            </Button>
          ) : (
            <Button
              type="button"
              variant="dark"
              size="lg"
              icon={<ClipboardPaste />}
              className="h-12 px-5"
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

        <SampleLinks />
      </Sheet.Body>
    </div>
  );
}

/** Placeholder merchants' links, so every checkout path can be tried. */
function SampleLinks() {
  const router = useRouter();
  const links = useData(
    async () => (await Promise.all(SAMPLE_LINK_IDS.map((id) => getPaymentLink(id)))).filter((l): l is PaymentLink => l !== null),
    [],
  );
  return (
    <>
      <SectionHeader title="Try a sample link" className="mt-2" />
      <div className="flex flex-col gap-2">
        {links.value
          ? links.value.map((link) => (
              <AssetRow
                key={link.id}
                leading={<MerchantAvatar name={link.merchant.name} />}
                title={link.merchant.name}
                subtitle={`${link.description}${link.modes.later ? " · Pay in 4" : ""}${link.modes.subscription ? " · Monthly" : ""}`}
                value={usd(link.amount, { trim: true })}
                trend="flat"
                onClick={() => router.push(`/pay/${link.id}`, { scroll: false })}
              />
            ))
          : [0, 1, 2].map((i) => <Skeleton key={i} shape="row" height={72} />)}
      </div>
    </>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function PayRoute({ cold }: { cold?: boolean }) {
  return (
    <RouteSheet label="Pay or claim a link" snapPoints={["full"]} cold={cold}>
      <PaySheet />
    </RouteSheet>
  );
}
