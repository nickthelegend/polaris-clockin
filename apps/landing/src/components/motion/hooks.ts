"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { VIEW_AMOUNT } from "./tokens";

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * True when the visitor asked for reduced motion. Primitives then render their
 * final state and skip the animation.
 */
export function useReduced(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * A ref plus whether it has entered the viewport (once). `amount` is the share
 * of the element that must be visible: 20% by default, as the spec asks.
 */
export function useReveal<T extends Element>(amount: number = VIEW_AMOUNT) {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true, amount });
  return [ref, inView] as const;
}

/**
 * Resolves the "should this animate to its final state now" flag for a
 * primitive: an explicit `play` wins, otherwise the element's own visibility.
 */
export function usePlay<T extends Element>(play: boolean | undefined, amount?: number) {
  const [ref, inView] = useReveal<T>(amount);
  const reduced = useReduced();
  const shown = reduced || (play ?? inView);
  return { ref, shown, reduced } as const;
}

/** True after the first client render; SSR renders the pre-animation state. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
