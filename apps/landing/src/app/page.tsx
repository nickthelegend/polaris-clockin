import { CreditSection } from "@/components/sections/CreditSection";
import { Faq } from "@/components/sections/Faq";
import { Hero } from "@/components/sections/Hero";
import { LogoStrip } from "@/components/sections/LogoStrip";
import { Pricing } from "@/components/sections/Pricing";
import { StripeSection } from "@/components/sections/StripeSection";
import { Testimonial } from "@/components/sections/Testimonial";
import { getAssets } from "@/lib/assets";

export default function Page() {
  const assets = getAssets();
  return (
    <main>
      <Hero assets={assets} />
      <LogoStrip />
      <StripeSection assets={assets} />
      <CreditSection assets={assets} />
      <Pricing />
      <Faq />
      <Testimonial assets={assets} />
    </main>
  );
}
