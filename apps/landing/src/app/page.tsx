import { Blog } from "@/components/sections/Blog";
import { CreditSection } from "@/components/sections/CreditSection";
import { Faq } from "@/components/sections/Faq";
import { Footer } from "@/components/sections/Footer";
import { Hero } from "@/components/sections/Hero";
import { LogoStrip } from "@/components/sections/LogoStrip";
import { Pricing } from "@/components/sections/Pricing";
import { StripeSection } from "@/components/sections/StripeSection";
import { Talk } from "@/components/sections/Talk";
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
      <Blog assets={assets} />
      {/* The closing gradient: white to lime, running on behind the footer */}
      <div className="bg-[linear-gradient(180deg,#fdfff2_0%,#f6fdd0_22%,#f0feb3_44%,#e8fe8c_70%,#e1ff67_100%)]">
        <Talk assets={assets} />
        <Footer />
      </div>
    </main>
  );
}
