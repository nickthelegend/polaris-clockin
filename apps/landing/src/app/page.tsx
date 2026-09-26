import { Hero } from "@/components/sections/Hero";
import { getAssets } from "@/lib/assets";

export default function Page() {
  const assets = getAssets();
  return (
    <main>
      <Hero assets={assets} />
    </main>
  );
}
