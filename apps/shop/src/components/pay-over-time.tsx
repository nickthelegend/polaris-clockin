import Image from "next/image";
import Link from "next/link";

import { ImageReveal } from "@/components/reveal";
import type { Product } from "@/lib/catalog";
import { formatUsd } from "@/lib/money";
import { quotePayIn4 } from "@/lib/polaris";
import { PolarisLockup, PolarisMark } from "@/lib/polaris-client";

const WHEN = ["Today", "Week 2", "Week 3", "Week 4"];

/** The store's "Pay over time with Polaris" band, as a store would run a BNPL provider's promotion. */
export function PayOverTimeBand({ aprBps, example }: { aprBps: number; example: Product }) {
  const quote = quotePayIn4((example.price / 100).toFixed(2), { aprBps });
  const each = formatUsd(Math.round(Number(quote.each) * 100));
  const facts = [
    {
      title: quote.interestFree ? "4 interest-free payments" : "4 payments",
      body: quote.interestFree ? "On any order over $50, split evenly." : `A 10% APR, pro-rated: ${formatUsd(Math.round(Number(quote.interest) * 100))} on this chair, shown before you confirm.`,
    },
    { title: "An instant decision", body: "Polaris answers at checkout, in seconds. No forms." },
    { title: "No fees when you pay on time", body: "Payments come out automatically each week." },
  ];

  return (
    <section id="pay-over-time" aria-labelledby="pot-title" className="mt-24 scroll-mt-20 bg-sand lg:mt-36">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-20 lg:px-10 lg:py-28">
        <div>
          <h2 id="pot-title" className="display text-[2.6rem] leading-[1.02] sm:text-[3.4rem] lg:text-[4rem]">
            Pay over time
            <br />
            with{" "}
            <span className="whitespace-nowrap">
              <PolarisMark title="" className="!h-[0.78em] !w-[0.7em] align-[-0.02em]" /> Polaris.
            </span>
          </h2>
          <p className="mt-6 max-w-[31rem] text-[1.06rem] leading-relaxed text-ink-2">
            Choose Polaris at checkout and split your order into four payments: one today, then one each week. Confirm with Face ID. There is
            no card to type in.
          </p>
          <dl className="mt-10 max-w-[34rem] divide-y divide-hair-strong border-y border-hair-strong">
            {facts.map((fact) => (
              <div key={fact.title} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                <dt className="font-medium">{fact.title}</dt>
                <dd className="text-[0.95rem] text-muted">{fact.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ImageReveal>
          <figure className="rounded-[22px] bg-[#111210] p-6 text-[#f5f5f5] shadow-[0_40px_80px_-40px_rgb(29_28_26/0.55)] sm:p-9">
            <div className="flex items-center justify-between">
              <PolarisLockup className="text-[1.05rem]" />
              <span className="text-[0.82rem] text-white/55">Pay in 4</span>
            </div>
            <div className="mt-8 flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#f2eee7]">
                <Image src={example.image} alt="" fill sizes="64px" className="object-cover" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">{example.name}</p>
                <p className="num text-[0.92rem] text-white/60">{formatUsd(example.price)} today, in full, to Halcyon</p>
              </div>
            </div>
            <p className="num mt-8 text-[2.6rem] font-semibold leading-none tracking-[-0.03em] sm:text-[3.2rem]">
              4 × {each}
            </p>
            <ol className="mt-8 grid grid-cols-4 gap-2 sm:gap-3" aria-label="Payment schedule">
              {quote.installments.map((inst, i) => (
                <li key={inst.index} className="grid gap-2 text-[0.8rem] text-white/60 sm:text-[0.86rem]">
                  <span className={`h-1.5 rounded-full ${i === 0 ? "bg-[#bffa62]" : "bg-white/15"}`} />
                  <span className="num text-[0.92rem] font-medium text-white sm:text-[1rem]">{formatUsd(Math.round(Number(inst.amount) * 100))}</span>
                  {WHEN[i]}
                </li>
              ))}
            </ol>
            <figcaption className="mt-8 border-t border-white/10 pt-5 text-[0.86rem] leading-relaxed text-white/60">
              Halcyon is paid in full when you order. You pay Polaris over four weeks.{" "}
              <Link href={`/products/${example.slug}`} className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                See the chair
              </Link>
            </figcaption>
          </figure>
        </ImageReveal>
      </div>
    </section>
  );
}
