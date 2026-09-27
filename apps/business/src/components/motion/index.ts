/**
 * The landing page's motion primitives, from apps/landing (same tokens, same
 * reveal-on-scroll, the same Lenis setup), so the merchant landing moves like
 * the consumer one. Every primitive shows its final state under reduced motion.
 */
export { BlurWords } from "./BlurWords";
export { BlurLines, type Segment } from "./BlurLines";
export { Rise } from "./Rise";
export { Marquee } from "./Marquee";
export { CountUp, useCountUp } from "./CountUp";
export { DrawLine } from "./DrawLine";
export { SmoothScroll } from "./SmoothScroll";
export { useReduced, useReveal, usePlay, useMounted } from "./hooks";
export * from "./tokens";
