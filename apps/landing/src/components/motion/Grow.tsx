"use client";

import { motion, type Variants } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReduced, useVisibleOnce } from "./hooks";
import { CARD_RISE, EASE_REVEAL } from "./tokens";

type Custom = {
  from: number;
  radius: number;
  y: number;
  delay: number;
  duration: number;
};

const inset = (top: number, radius: number) => `inset(${top}% 0% 0% 0% round ${radius}px)`;

const growVariants: Variants = {
  hidden: ({ from, radius, y }: Custom) => ({
    clipPath: inset((1 - from) * 100, radius),
    y,
    opacity: 0,
  }),
  visible: ({ radius, delay, duration }: Custom) => ({
    clipPath: inset(0, radius),
    y: 0,
    opacity: 1,
    transition: {
      delay,
      duration,
      ease: EASE_REVEAL,
      opacity: { delay, duration: 0.35, ease: "easeOut" },
    },
  }),
};

export type GrowProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Visible share of the height at the start (0..1). The card grows up from its bottom edge. */
  from?: number;
  radius?: number;
  /** It also rises this far while growing, px. */
  y?: number;
  delay?: number;
  duration?: number;
  play?: boolean;
  amount?: number;
  id?: string;
};

/**
 * A card that grows from a shorter height, anchored to its bottom edge, as it
 * rises 40px and fades in. The growth is a clip-path, so layout never moves.
 */
export function Grow({
  children,
  className,
  style,
  from = 0.45,
  radius = 22,
  y = CARD_RISE,
  delay = 0,
  duration = 1,
  play,
  amount,
  id,
}: GrowProps) {
  const [ref, visible] = useVisibleOnce<HTMLDivElement>(amount);
  const reduced = useReduced();
  const shown = reduced || (play ?? visible);
  return (
    <motion.div
      ref={ref}
      id={id}
      className={cn("rv", className)}
      style={style}
      variants={growVariants}
      custom={{ from, radius, y, delay, duration } satisfies Custom}
      initial="hidden"
      animate={shown ? "visible" : "hidden"}
    >
      {children}
    </motion.div>
  );
}
