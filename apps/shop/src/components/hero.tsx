"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The first viewport: a room in late-afternoon light with the collection in
 * it. The photograph opens from a narrow band, the way light comes through a
 * door, and the headline settles after it. Under reduced motion the
 * MotionConfig in ShopProvider drops the movement and keeps the fades.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="relative mx-auto max-w-[1440px] lg:px-10">
        <motion.div
          className="relative h-[58svh] min-h-[380px] overflow-hidden sm:h-[64svh] lg:h-[calc(100svh-150px)] lg:max-h-[860px] lg:min-h-[600px] lg:rounded-[3px]"
          initial={{ clipPath: "inset(18% 8% 18% 8%)" }}
          animate={{ clipPath: "inset(0% 0% 0% 0%)" }}
          transition={{ duration: 1.5, ease: EASE }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ scale: 1.12 }}
            animate={{ scale: 1 }}
            transition={{ duration: 2.2, ease: EASE }}
          >
            <Image
              src="/products/hero.jpg"
              alt="A sunlit corner with an oak lounge chair, Halcyon One headphones on the seat, and an Arc lamp and instant camera on a side table"
              fill
              preload
              sizes="(min-width: 1440px) 1360px, 100vw"
              className="object-cover object-[86%_50%] lg:object-center"
            />
          </motion.div>
        </motion.div>

        <div className="px-4 pt-8 sm:px-6 lg:absolute lg:inset-y-0 lg:left-10 lg:flex lg:w-[46%] lg:flex-col lg:justify-center lg:px-16 lg:pt-0">
          <motion.h1
            id="hero-title"
            className="display text-[3.1rem] leading-[0.98] sm:text-[4.2rem] lg:text-[clamp(4.2rem,6vw,6rem)]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.55, ease: EASE }}
          >
            Quiet things,
            <br />
            made to last.
          </motion.h1>
          <motion.p
            className="mt-5 max-w-[26rem] text-[1.08rem] leading-relaxed text-ink-2 lg:mt-6 lg:text-[1.15rem]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.75, ease: EASE }}
          >
            Headphones, lamps, chairs and the everyday objects around them, for slower days at home.
          </motion.p>
          <motion.div
            className="mt-8 flex flex-wrap gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.9, ease: EASE }}
          >
            <Link href="/shop" className="btn btn-ink">
              Shop the collection
            </Link>
            <Link href="/products/halcyon-one" className="btn btn-line lg:bg-paper/40">
              Meet Halcyon One
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
