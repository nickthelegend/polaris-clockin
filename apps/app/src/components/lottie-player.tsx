"use client";

import { type LottieHandle, LottieSvg } from "lottie-react";
import { useEffect, useRef } from "react";

export type LottieJson = { layers: unknown[]; markers?: { cm?: string; tm?: number }[] };

/**
 * One onboarding animation, drawn with lottie-react's svg build. Loaded only
 * in the browser (see onboarding-art.tsx). It plays from the start whenever
 * its page comes into view and rests while another page is showing. Reduced
 * motion holds it on the file's "still" marker instead of playing.
 */
export default function LottiePlayer({
  data,
  reduced,
  active = true,
  className,
}: {
  data: LottieJson;
  reduced: boolean;
  active?: boolean;
  className?: string;
}) {
  const ref = useRef<LottieHandle>(null);
  const hasStill = data.markers?.some((m) => m.cm === "still") ?? false;
  const want = useRef({ active, reduced });

  const apply = () => {
    const handle = ref.current;
    if (!handle) return;
    if (want.current.reduced) {
      handle.pause();
      handle.seek(hasStill ? { marker: "still" } : 0);
    } else if (want.current.active) {
      handle.seek(0);
      handle.play();
    } else {
      handle.pause();
    }
  };

  useEffect(() => {
    want.current = { active, reduced };
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced]);

  return (
    <LottieSvg
      src={data}
      autoplay={false}
      loop={!reduced}
      lottieRef={ref}
      rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
      subscriptions={{ ready: apply }}
      className={className}
    />
  );
}
