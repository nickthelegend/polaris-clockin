"use client";

import { motion, type Variants } from "motion/react";
import { createElement, Fragment } from "react";
import { cn } from "@/lib/cn";
import { usePlay } from "./hooks";
import { EASE_REVEAL, WORD_BLUR, WORD_DURATION, WORD_RISE, WORD_STAGGER } from "./tokens";

type Tag = "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";

type Timing = { delay: number; duration: number };

export const wordVariants: Variants = {
  hidden: { opacity: 0, filter: `blur(${WORD_BLUR}px)`, y: WORD_RISE },
  visible: ({ delay, duration }: Timing) => ({
    opacity: 1,
    filter: "blur(0px)",
    y: "0em",
    transition: { delay, duration, ease: EASE_REVEAL },
  }),
};

export type BlurWordsProps = {
  /** A string, or one string per line (lines break on md and up). */
  text: string | readonly string[];
  as?: Tag;
  className?: string;
  /** Classes for each line wrapper. Defaults to breaking lines from md up. */
  lineClassName?: string;
  wordClassName?: string;
  /** Seconds before the first word. */
  delay?: number;
  /** Seconds between words (70ms). */
  stagger?: number;
  duration?: number;
  /** Drive it from outside; otherwise it plays when 20% visible. */
  play?: boolean;
  amount?: number;
  id?: string;
};

/**
 * Word-by-word blur reveal: each word goes from opacity 0, blur(12px) and
 * 0.25em down to its place, 700ms on cubic-bezier(.2,.7,.2,1), 70ms apart.
 */
export function BlurWords({
  text,
  as = "span",
  className,
  lineClassName = "md:block",
  wordClassName,
  delay = 0,
  stagger = WORD_STAGGER,
  duration = WORD_DURATION,
  play,
  amount,
  id,
}: BlurWordsProps) {
  const lines = typeof text === "string" ? [text] : text;
  const { ref, shown, reduced } = usePlay<HTMLElement>(play, amount);
  let index = 0;

  const children = (
    <>
      <span className="sr-only">{lines.join(" ")}</span>
      <span aria-hidden="true">
        {lines.map((line, li) => {
          const words = line.split(" ").filter(Boolean);
          return (
            <Fragment key={li}>
              <span className={lineClassName}>
                {words.map((word, wi) => {
                  const i = index++;
                  return (
                    <Fragment key={wi}>
                      <motion.span
                        className={cn("reveal-word", wordClassName)}
                        variants={wordVariants}
                        custom={{ delay: delay + i * stagger, duration } satisfies Timing}
                        initial={reduced ? false : "hidden"}
                        animate={shown ? "visible" : "hidden"}
                      >
                        {word}
                      </motion.span>
                      {wi < words.length - 1 ? " " : null}
                    </Fragment>
                  );
                })}
              </span>
              {li < lines.length - 1 ? " " : null}
            </Fragment>
          );
        })}
      </span>
    </>
  );

  return createElement(as, { ref, className, id }, children);
}
