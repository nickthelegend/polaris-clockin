import { Hero } from "@/components/sections/Hero";
import { LogoStrip } from "@/components/sections/LogoStrip";
import { getAssets } from "@/lib/assets";

export default function Page() {
  const assets = getAssets();
  return (
    <main>
      <Hero assets={assets} />
      <LogoStrip />
    </main>
  );
}
