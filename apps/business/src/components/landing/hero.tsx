"use client";

import { Badge, Button, CandlestickChart, Card, Money, PhoneFrame, StatCard, cn } from "@polaris/ui";
import { ArrowRight, Check, Layers, Percent, Store } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { BusinessMark } from "@/components/app/brand";
import { Glass } from "@/components/app/glass";
import { BlurWords, Rise } from "@/components/motion";
import { CheckoutPreview } from "./checkout-preview";
import { hero, heroCandles, heroSalesSpark } from "./content";
import { DemoShopButton } from "./demo-shop";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden pt-[112px] pb-16 sm:pt-[136px] lg:pb-24">
      <div aria-hidden className="grid-ground absolute inset-x-0 top-0 -z-10 h-[900px]" />
      <div aria-hidden className="glow-lime absolute -top-[180px] left-1/2 -z-10 h-[620px] w-[980px] -translate-x-1/2" />
      <div aria-hidden className="glow-violet absolute top-[520px] -right-[220px] -z-10 h-[620px] w-[620px]" />

      {/* The glass renders, drifting at the edges. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 mx-auto max-w-[1440px]">
        <Glass art="coin-lime" size={150} priority className="float-slow absolute top-[128px] left-[3%] hidden w-[110px] opacity-90 md:block lg:w-[150px]" />
        <Glass art="coin-purple" size={170} priority className="float-slower absolute top-[210px] right-[2%] hidden w-[120px] opacity-90 md:block lg:w-[170px]" />
        <Glass art="coin-crimson" size={96} className="float-slow absolute top-[470px] left-[12%] hidden w-[80px] opacity-80 lg:block" />
      </div>

      <div className="mx-auto flex max-w-[1280px] flex-col items-center px-4 text-center sm:px-6 lg:px-8">
        <Rise y={10} blur={6} duration={0.7}>
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-ui-surface-1/80 px-4 text-[14px] text-ui-muted ring-1 ring-white/8 backdrop-blur">
            <span aria-hidden className="size-2 rounded-full bg-ui-lime shadow-[0_0_12px_2px_rgb(156_239_94/0.6)]" />
            {hero.eyebrow}
          </span>
        </Rise>

        <h1
          id="hero-title"
          aria-label={hero.headline.join(" ")}
          className="mt-6 text-[clamp(44px,7.2vw,104px)] leading-[0.98] font-medium tracking-[-0.05em] text-balance"
        >
          <BlurWords as="span" css text={hero.headline[0]!} className="block" lineClassName="block" delay={0.05} />
          <BlurWords as="span" css text={hero.headline[1]!} className="block text-ui-lime" lineClassName="block" delay={0.3} />
        </h1>

        <Rise y={16} blur={8} delay={0.45} duration={0.8}>
          <p className="mt-6 max-w-[620px] text-[17px] leading-[1.5] text-ui-muted sm:text-[19px]">{hero.sub}</p>
        </Rise>

        <Rise y={16} delay={0.6} duration={0.8} className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild variant="lime" size="lg" iconRight={<ArrowRight />}>
            <Link href="/login">{hero.primary}</Link>
          </Button>
          <DemoShopButton icon={<Store />} variant="outline" size="lg" label={hero.secondary} />
        </Rise>

        <Rise y={10} delay={0.75} duration={0.8}>
          <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-ui-muted">
            {hero.trust.map((t) => (
              <li key={t} className="inline-flex items-center gap-2">
                <Check aria-hidden size={15} strokeWidth={2.25} className="text-ui-lime" />
                {t}
              </li>
            ))}
          </ul>
        </Rise>
      </div>

      <ProductVisual />
    </section>
  );
}

/* ── The live product visual: real components, not a screenshot ──────────── */

function ProductVisual() {
  const [frame, setFrame] = useState("1M");
  const [paid, setPaid] = useState(0);

  return (
    // Tall: reveal as soon as its top edge shows, not at 20% (a 768px-high
    // screen would otherwise show an empty band under the buttons).
    <Rise y={48} blur={10} delay={0.55} duration={1.1} amount={0.04} className="relative mx-auto mt-14 max-w-[1180px] px-4 sm:px-6 lg:mt-20 lg:px-8">
      <div className="relative flex flex-col items-center gap-6 lg:block lg:h-[724px]">
        {/* The dashboard panel. */}
        <Card
          padding="none"
          aria-label="The Polaris for Business dashboard"
          className="w-full overflow-hidden ring-1 ring-white/6 lg:absolute lg:top-0 lg:right-0 lg:w-[calc(100%-240px)] xl:w-[800px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-ui-hairline px-5 py-4">
            <span className="flex items-center gap-2.5">
              <BusinessMark size={24} />
              <span className="text-[16px] font-medium">Overview</span>
            </span>
            <span className="flex items-center gap-2 text-[13px] text-ui-muted">
              <span aria-hidden className="size-2 rounded-full bg-ui-lime" />
              Oat &amp; Ember
            </span>
          </div>
          <div className="grid gap-4 p-4 sm:p-5 lg:pl-[130px] xl:pl-14">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard
                tone="sage"
                icon={<Percent />}
                label="Sales"
                delta={23}
                value={<Money value={24575 + paid * 200} decimals={0} spaced dim="none" animate />}
                spark={heroSalesSpark}
              />
              <StatCard
                tone="pink"
                icon={<Layers />}
                label="Pay in 4"
                delta={12}
                value={<Money value={19839} decimals={0} spaced dim="none" />}
                spark={[8, 9, 8.5, 10, 11, 9.8, 12, 11.5, 12.8, 12.2, 13.9, 14.2]}
                className="hidden sm:block"
              />
            </div>
            <CandlestickChart
              label="Daily payment volume, thousands of dollars"
              data={heroCandles}
              height={300}
              reference={{ value: 97.45 }}
              timeframes={["1W", "1M", "3M"]}
              timeframe={frame}
              onTimeframeChange={setFrame}
              leading={<span className="hidden px-2 text-[15px] font-medium whitespace-nowrap sm:inline">Daily volume ($K)</span>}
              className="rounded-ui-tile"
            />
          </div>
        </Card>

        {/* The phone with the checkout, overlapping the panel on wide screens. */}
        <div className="relative z-10 lg:absolute lg:top-[64px] lg:left-[40px]">
          <Glass art="card-lime" size={220} className="float-slower absolute -top-[70px] -left-[90px] -z-10 hidden w-[200px] rotate-[-14deg] opacity-80 xl:block" />
          <PhoneFrame width={290} className="shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9)]">
            <CheckoutPreview compact onPaid={() => setPaid((n) => n + 1)} />
          </PhoneFrame>
          <AnimatePresence>
            {paid > 0 ? (
              <motion.div
                key={paid}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute -right-6 bottom-24 hidden items-center gap-2.5 rounded-full bg-ui-surface-3 py-2 pr-4 pl-2 shadow-ui-pop sm:flex"
              >
                <span className="grid size-7 place-items-center rounded-full bg-ui-lime text-ui-on-lime">
                  <Check size={15} strokeWidth={2.5} aria-hidden />
                </span>
                <span className="text-[14px] font-medium">+$200.00 settled</span>
                <Badge tone="lime" size="sm">
                  0.8 s
                </Badge>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <p className={cn("mt-4 text-center text-[13px] text-ui-muted lg:mt-2")}>
        A live preview with an invented studio. Switch the payment mode and press pay.
      </p>
    </Rise>
  );
}
